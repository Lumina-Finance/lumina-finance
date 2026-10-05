"""Recording each sync attempt on a linked account, and retrying the ones that fail

Every attempt a sync makes for a link is recorded on it: when its request was sent and, when it
failed, why. A failure never moves the time of the link's last successful sync. A failed attempt
starts a retry series, or carries one on: a retry follows 30, 60 and 90 minutes after the attempt
before it, so a series has four attempts, and once the fourth fails automatic sync rests for 12 hours
before an attempt that starts a new series if it fails too. A link waiting to retry joins no sync
before its retry is due, so it isn't fetched ahead of its schedule with the connection's other links.

Retrying can't fix a rejected credential or a bank sign-in problem, so neither starts a series: a
rejected credential stops the connection's automatic sync until the user reconnects, and a link
whose bank needs a sign-in stays on the connection's daily schedule. A retry, like any sync, waits
for a free request when the budget is spent or the provider has asked for fewer requests, which
counts as no attempt
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_sync_job import BankSyncJobKind, ProviderErrorKind
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.provider_requests import read_request_budget
from app.services.bank_sync.providers.contract import ProviderError

# The wait before each retry in a series, from the attempt before it, then the rest that follows a
# series whose every attempt failed
RETRY_DELAYS = (timedelta(minutes=30), timedelta(minutes=60), timedelta(minutes=90))
RETRY_SERIES_REST = timedelta(hours=12)

# The failures retrying can't fix, which start no retry series
_NOT_RETRIED = frozenset({ProviderErrorKind.CREDENTIAL_REJECTED, ProviderErrorKind.BANK_LOGIN_NEEDED})


def is_waiting_to_retry(link: BankAccountLink) -> bool:
    """Return whether a link's last attempt failed and its next is a retry, or the attempt that ends a series' rest"""
    return link.retry_count > 0


def record_successful_attempt(link: BankAccountLink, *, at: datetime) -> None:
    """Record an attempt that brought a link up to date, which ends any retry series it was in

    Args:
        link: The link, locked by the caller
        at: When the attempt's request was sent
    """
    link.last_attempt_at = at
    link.last_failure_reason = None
    link.retry_count = 0
    link.next_attempt_at = None


def record_failed_attempt(link: BankAccountLink, error: ProviderError, *, at: datetime) -> None:
    """Record an attempt that failed for a link, and when it is tried again unless retrying can't help

    Args:
        link: The link, locked by the caller
        error: Why the attempt failed, whose reason the account's sync status shows
        at: When the attempt's request was sent, or the job stopped when it sent none
    """
    link.last_attempt_at = at
    link.last_failure_reason = error.reason
    if error.kind in _NOT_RETRIED:
        link.retry_count = 0
        link.next_attempt_at = None
        return

    # The attempt after a series' rest counts as the first of a new series
    waits = (*RETRY_DELAYS, RETRY_SERIES_REST)
    link.retry_count = link.retry_count % len(waits) + 1
    link.next_attempt_at = at + waits[link.retry_count - 1]


async def queue_next_retry(
    db: AsyncSession,
    connection: BankConnection,
    *,
    ended_by: ProviderError | None,
    overdue: bool,
    started_at: datetime,
    now: datetime,
) -> None:
    """Queue a retry of the connection for the earliest retry its links wait on, once a request is free

    Called as each of the connection's jobs ends. A retry queued for later merges into any job queued
    sooner, which runs it early or leaves it waiting, so each job that ends queues the earliest one
    again, counting one that fell due while the job ran, which runs at once. A link waiting to retry
    that a job found due but left, since links that could progress came first, is retried at once
    too. A connection whose credential was rejected, by now or by the job's last request, retries
    nothing

    Args:
        db: The connection owner's session, which the caller commits, with the connection locked so
            no writer changes its links meanwhile
        connection: The connection, as locked
        ended_by: What stopped the job, or None when it did all it could
        overdue: Whether the ending job left a link whose retry was due
        started_at: When the job's attempt started, which it found the links due at
        now: When the job ends
    """
    rejected = ended_by is not None and ended_by.kind == ProviderErrorKind.CREDENTIAL_REJECTED
    if rejected or connection.credential_rejected_at is not None:
        return
    links = await db.scalars(
        select(BankAccountLink).where(
            BankAccountLink.connection_id == connection.id,
            BankAccountLink.state == BankLinkState.ACTIVE,
            BankAccountLink.paused.is_(False),
        )
    )
    times = [link.next_attempt_at for link in links if is_waiting_to_retry(link) and link.next_attempt_at > started_at]
    if overdue:
        times.append(now)
    if not times:
        return

    # A retry run before a request frees would only find the budget spent and queue itself again
    budget = await read_request_budget(db, connection, now=now)
    run_after = max(min(times), budget.available_again_at or now)
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.RETRY, run_after=run_after)
