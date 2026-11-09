"""Syncing a linked account now, as the user asks from its Bank link section

The request queues a sync of the account's connection for the worker. The worker syncs the account
whatever its next daily time, a retry's included, and takes in every other account on the connection
that isn't waiting on a retry or on the user, in the same request to the provider. A sync already queued for the connection
takes the request in rather than queueing another. The request is refused, saying why, while an
import or a sync already runs on the account, while only the user can restart its sync, while the
review pause holds it, and while the connection's request budget is spent. A bank sign-in doesn't
refuse it, so the user can check straight after signing in again at the provider, unless a sync
already runs on the account, and the bank sign-in shows over that in its state
"""

import math
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink
from app.models.bank_sync_job import BankSyncJobKind
from app.models.user import User
from app.schemas.bank_sync import BankLinkResponse, BankSyncState, BankSyncStatusResponse
from app.services.accounts.access import get_own_personal_account
from app.services.bank_sync.account_link import describe_links
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL, LIVE_LINK, PROVIDER_GONE_DETAIL, adapter_for
from app.services.bank_sync.connections import get_own_connection
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.links import ACCOUNT_NOT_LINKED
from app.services.bank_sync.provider_requests import read_request_budget
from app.services.bank_sync.review_pause import RESUME_AT
from app.services.bank_sync.status import read_link_statuses
from app.services.cache_state import mark_user_status_changed

# Why a sync can't start now in each state that holds it back, as the Sync now button says it
_REFUSALS: dict[BankSyncState, str] = {
    "importing": "The import is still running",
    "reconnect_needed": "Reconnect {provider} in Settings before syncing",
    "choose_account": "Choose the bank account again before syncing",
    "paused": f"Syncing is paused until {RESUME_AT} or fewer new items are waiting for review",
}

# Why a sync can't start while a worker already syncs the account, whatever its state shows
_SYNC_RUNNING = "A sync is already running"

# Why a sync can't start while the connection's request budget is spent, and when it can. The budget
# counts the last 24 hours rather than a calendar day
_BUDGET_SPENT = "This connection has used its {limit} {provider} requests in the last 24 hours. More are available {when}"

# Why a sync can't start while the provider's word that its quota is spent holds the connection back
# though it sent fewer than its limit, and when it can
_PROVIDER_LIMIT = "{provider} says this connection has reached its request limit. More are available {when}"

# The units a wait is told in, largest first, each with its length in seconds. A request leaves the
# budget a day after it was sent, so hours tell any wait
_WAIT_UNITS = (("hour", 3600), ("minute", 60))


async def sync_account_now(db: AsyncSession, user: User, account_id: uuid.UUID) -> BankLinkResponse:
    """Queue a sync of one of the user's linked accounts for straight away, unless something holds it back

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account

    Returns:
        The link. Its status says the sync is requested until a worker starts it

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 409: An import or a sync already runs on the account, the provider rejected
            its connection or is no longer installed, its bank account has to be chosen again, or
            the review pause holds it
        HTTPException 429: The connection's request budget is spent, saying when a request frees up
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    link = await db.scalar(select(BankAccountLink).where(BankAccountLink.account_id == account.id, LIVE_LINK))
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ACCOUNT_NOT_LINKED)

    # Shared, so a disconnect waits until the sync is queued and then deletes it with the connection
    connection = await get_own_connection(db, user.id, link.connection_id, lock={"read": True, "key_share": True})
    adapter = adapter_for(connection.provider)
    if adapter is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=PROVIDER_GONE_DETAIL)
    provider = adapter.provider_name
    now = datetime.now(UTC)
    [link_status] = (await read_link_statuses(db, [link], now=now)).values()
    refusal = _find_refusal(link_status.sync)
    if refusal is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=refusal.format(provider=provider))
    budget = await read_request_budget(db, connection, now=now)
    if budget.available_again_at is not None:
        spent = _PROVIDER_LIMIT if budget.held_by_provider else _BUDGET_SPENT
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=spent.format(limit=budget.limit, provider=provider, when=_describe_wait(budget.available_again_at, now)),
        )

    await enqueue_bank_sync_job(db, owner_id=user.id, connection_id=connection.id, kind=BankSyncJobKind.MANUAL, requested_link_ids=[link.id])
    # The link now reads as requested. That changes none of the user's data, so the data mark an
    # import's undo compares with stays where it was
    await mark_user_status_changed(db, user.id)
    await db.commit()
    [described] = await describe_links(db, user, [link], now=datetime.now(UTC))
    return described


def _find_refusal(sync: BankSyncStatusResponse) -> str | None:
    """Return why a link's state or a sync already running on it holds a sync back, or None when nothing does

    An import says so first, since it runs to today. Otherwise a sync a worker already runs refuses
    another whatever the state, as a bank sign-in shows over it
    """
    if sync.state != "importing" and sync.sync_running:
        return _SYNC_RUNNING
    return _REFUSALS.get(sync.state)


def _describe_wait(until: datetime, now: datetime) -> str:
    """Return how long until a moment as the app's tooltips put it, such as in 3 hours, to the nearest hour or minute"""
    seconds = (until - now).total_seconds()
    for unit, length in _WAIT_UNITS:
        if seconds >= length:
            # Halves round up, as the app's tooltips round them
            count = math.floor(seconds / length + 0.5)
            return f"in {count} {unit}{'' if count == 1 else 's'}"
    return "shortly"
