"""Recording each sync attempt on a linked account, and retrying the ones that fail

Every attempt a sync makes for a link is recorded on it: when its request was sent and, when it
failed, why. A failure never moves the time of the link's last successful sync. A failed attempt
starts a retry series, or carries one on: a retry follows 30, 60 and 90 minutes after the attempt
before it, so a series has four attempts, and once the fourth fails automatic sync rests for 12 hours
before an attempt that starts a new series if it fails too. A link waiting to retry joins no sync
before its retry is due, so it isn't fetched ahead of its schedule with the connection's other links.

Retrying can't fix a rejected credential, a bank sign-in problem or a payment problem, so none
starts a series: a rejected credential stops the connection's automatic sync until the user
reconnects, and a link whose bank needs a sign-in, or whose provider needs a payment, stays on the
connection's daily schedule. Nor does a refused date range, which the sync first tries again in halves and
then stops on, as the sync module describes. A retry, like any sync, waits
for a free request when the budget is spent or the provider has asked for fewer requests. That
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
from app.services.bank_sync.review_pause import is_paused_for_review

# The wait before each retry in a series, from the attempt before it, then the rest that follows a
# series whose every attempt failed
RETRY_DELAYS = (timedelta(minutes=30), timedelta(minutes=60), timedelta(minutes=90))
RETRY_SERIES_REST = timedelta(hours=12)

# The failures retrying can't fix. None starts a retry series
_NOT_RETRIED = frozenset({ProviderErrorKind.CREDENTIAL_REJECTED, ProviderErrorKind.BANK_LOGIN_NEEDED, ProviderErrorKind.PAYMENT_REQUIRED})

# The failures among them that wait for the link's next daily sync, since the user may have fixed
# the cause by then. A rejected credential waits for nothing
_WAITS_FOR_DAILY_SYNC = frozenset({ProviderErrorKind.BANK_LOGIN_NEEDED, ProviderErrorKind.PAYMENT_REQUIRED})


def is_waiting_to_retry(link: BankAccountLink) -> bool:
    """Return whether a link's last attempt failed and its next is a retry, or the attempt that ends a series' rest"""
    return link.retry_count > 0


def record_successful_attempt(link: BankAccountLink, *, at: datetime, next_sync: datetime | None) -> None:
    """Record an attempt that brought in a link's data and ends any retry series it was in

    Args:
        link: The link, locked by the caller
        at: When the attempt's request was sent
        next_sync: The link's next daily sync once the attempt brought it up to date through today,
            or None while it has days still to catch up, so it stays due
    """
    link.last_attempt_at = at
    link.last_failure_reason = None
    link.retry_count = 0
    link.next_attempt_at = next_sync


def record_failed_attempt(link: BankAccountLink, error: ProviderError, *, at: datetime, next_sync: datetime) -> None:
    """Record an attempt that failed for a link, and when it is tried again

    A failure retrying may fix starts or carries on a retry series. A bank sign-in or a payment
    problem waits for the link's next daily sync instead, and a rejected credential for nothing,
    since automatic sync stops until the user reconnects

    Args:
        link: The link, locked by the caller
        error: Why the attempt failed. The account's sync status shows its reason
        at: When the attempt's request was sent, or the job stopped when it sent none
        next_sync: When the link's next daily sync falls
    """
    link.last_attempt_at = at
    link.last_failure_reason = error.reason
    if error.kind in _NOT_RETRIED:
        link.retry_count = 0
        link.next_attempt_at = next_sync if error.kind in _WAITS_FOR_DAILY_SYNC else None
        return

    # The attempt after a series' rest counts as the first of a new series
    waits = (*RETRY_DELAYS, RETRY_SERIES_REST)
    link.retry_count = link.retry_count % len(waits) + 1
    link.next_attempt_at = at + waits[link.retry_count - 1]


def record_refused_attempt(link: BankAccountLink, reason: str, *, at: datetime, next_sync: datetime) -> None:
    """Record an attempt the provider refused even for a short window, which starts no retry series

    Asking again for the same dates only meets the same refusal, so nothing retries the link. It
    syncs again with the connection's next daily sync, at the full window, or when the user asks for
    a sync. The refusal never moves the link's checkpoint, and it ends any retry series the link was in

    Args:
        link: The link, locked by the caller
        reason: Why the attempt failed. The account's sync status shows it
        at: When the attempt's request was sent
        next_sync: When the link's next daily sync falls
    """
    link.last_attempt_at = at
    link.last_failure_reason = reason
    link.retry_count = 0
    link.next_attempt_at = next_sync


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
    sooner. That job runs it early or leaves it waiting, so each job that ends queues the earliest one
    again, counting one that fell due while the job ran, and that one runs at once. A link waiting to retry
    that a job found due but left, since links that could progress came first, is retried at once
    too. A link the review pause holds back retries nothing until the pause lifts, while one an
    import runs on retries whatever its pause. A connection whose credential was rejected, by now or
    by the job's last request, retries nothing

    Args:
        db: The connection owner's session, committed by the caller, with the connection locked so
            no writer changes its links meanwhile
        connection: The connection, as locked
        ended_by: What stopped the job, or None when it did all it could
        overdue: Whether the ending job left a link whose retry was due
        started_at: When the job's attempt started, the time it found the links due at
        now: When the job ends
    """
    rejected = ended_by is not None and ended_by.kind == ProviderErrorKind.CREDENTIAL_REJECTED
    if rejected or connection.credential_rejected_at is not None:
        return
    links = await db.scalars(
        select(BankAccountLink).where(BankAccountLink.connection_id == connection.id, BankAccountLink.state == BankLinkState.ACTIVE)
    )
    times = [
        link.next_attempt_at
        for link in links
        if not is_paused_for_review(link) and is_waiting_to_retry(link) and link.next_attempt_at > started_at
    ]
    if overdue:
        times.append(now)
    if not times:
        return

    # A retry run before a request frees would only find the budget spent and queue itself again
    budget = await read_request_budget(db, connection, now=now)
    run_after = max(min(times), budget.available_again_at or now)
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.RETRY, run_after=run_after)
