"""Limits on how often and how many password reset emails are sent

A failed send deletes its token so a retry is not locked out for a day, which leaves nothing else
to stop one address from starting a send, each able to hang for tens of seconds, on every request.
Failed sends instead back an account off for longer each time, and the sends running at once are
capped, with the rest waiting their turn in a bounded queue

The state lives in this process because the server runs as a single one, and a restart only forgets
the back-off and the queue. It is keyed by account id, so no address is kept and an unknown address,
which starts no send, adds nothing
"""

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from time import monotonic  # By name, so a test can drive this clock

from app.config.password_reset import PASSWORD_RESET_TOKEN_EXPIRE_SECONDS
from app.services.auth.send_backoff import SendBackoff

logger = logging.getLogger(__name__)

# Sends running at once across all accounts
MAX_CONCURRENT_RESET_SENDS = 3

# Sends waiting for a turn behind the running ones. A request beyond this starts no send
MAX_QUEUED_RESET_SENDS = 100

# Longest an admitted send holds its place if it never reports back, such as when the client
# disconnects and the send is dropped. A send that waited longer than the reset link lives is dropped
# unsent, so the lease is that life plus the longest one send can take
ADMISSION_LEASE_SECONDS = PASSWORD_RESET_TOKEN_EXPIRE_SECONDS + 300.0


@dataclass(frozen=True, eq=False)
class SendTicket:
    """One admitted send, identified by the object itself so an old send never frees a newer claim"""

    user_id: uuid.UUID
    lease_ends: float


reset_backoff = SendBackoff()
_admitted: dict[uuid.UUID, SendTicket] = {}

# Sends are queued on a semaphore, which belongs to one event loop, so one is made per loop
_slots: tuple[asyncio.AbstractEventLoop, asyncio.Semaphore] | None = None


def try_start_send(user_id: uuid.UUID) -> SendTicket | None:
    """Admit a send for one account unless it is backing off or the queue is full

    Synchronous, so the check and the claim cannot be split by another request

    Args:
        user_id: Account the reset email is for

    Returns:
        The ticket to hand to the send, or None when no send may start. None leaves nothing claimed
    """
    now = monotonic()
    for expired in [key for key, ticket in _admitted.items() if ticket.lease_ends <= now]:
        del _admitted[expired]

    if user_id in _admitted or reset_backoff.is_waiting(user_id):
        logger.info("A password reset email was not started because the account is waiting after a failed send or a send is under way")
        return None
    if len(_admitted) >= MAX_CONCURRENT_RESET_SENDS + MAX_QUEUED_RESET_SENDS:
        logger.info("A password reset email was not started because the queue of sends is full")
        return None

    ticket = SendTicket(user_id=user_id, lease_ends=now + ADMISSION_LEASE_SECONDS)
    _admitted[user_id] = ticket
    return ticket


def has_send_under_way(user_id: uuid.UUID) -> bool:
    """Whether an admitted send for the account is still running or waiting its turn, without claiming anything"""
    ticket = _admitted.get(user_id)
    return ticket is not None and ticket.lease_ends > monotonic()


def end_send(ticket: SendTicket) -> None:
    """Free the place of a send that ended, or whose request failed before it could be handed on"""
    if _admitted.get(ticket.user_id) is ticket:
        del _admitted[ticket.user_id]


@asynccontextmanager
async def wait_for_send_turn():
    """Hold one of the places for sends running at once, waiting in order for one to free"""
    global _slots

    loop = asyncio.get_running_loop()
    if _slots is None or _slots[0] is not loop:
        _slots = (loop, asyncio.Semaphore(MAX_CONCURRENT_RESET_SENDS))
    async with _slots[1]:
        yield
