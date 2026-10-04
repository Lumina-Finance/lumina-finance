"""Running bank sync jobs: the two operations every runner calls

Enqueueing due work and running jobs are each callable on their own and keep nothing between
calls, so the self-hosted worker's loop and a hosted runner on its own schedule share them. Each
sees across users only through the worker's definer functions, and runs everything else as the
owning user under row-level security
"""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session, current_user_id_ctx
from app.db.rls.functions import LIST_DUE_BANK_CONNECTIONS, RECORD_BANK_SYNC_SCAN
from app.models.bank_sync_job import BankSyncHeartbeat, BankSyncJobKind, ProviderErrorKind
from app.services.bank_sync.jobs import (
    ClaimedJob,
    JobNotHeld,
    claim_bank_sync_job,
    enqueue_bank_sync_job,
    finish_job,
    lock_job_for_finish,
)
from app.services.bank_sync.providers.contract import ProviderError
from app.services.bank_sync.sync import run_sync_job

logger = logging.getLogger(__name__)

# A job still running after this long is stopped and recorded as failed. A provider request has no
# overall limit of its own (looking up its host can take 5 seconds, each address it tries 5 more
# and each read 30), so this is what ends a job well inside the 10-minute lease its claim sets,
# before a later attempt could claim it
JOB_TIME_LIMIT = timedelta(minutes=5)

# A job is claimed again only when whatever ran it stopped without finishing it, such as a worker
# restarting mid-job. One that stops its runner every time would otherwise be claimed again every
# 10 minutes for good, spending a provider request each time and holding back the connection's
# queued job, so after this many attempts it is recorded as failed instead of run
MAX_JOB_ATTEMPTS = 3

# Sync counts as not running once the heartbeat every due scan stamps is older than this, the
# time three scans take
SYNC_STOPPED_AFTER = timedelta(minutes=15)

_TIMED_OUT = ProviderError(ProviderErrorKind.TEMPORARY, f"The sync took longer than {JOB_TIME_LIMIT.seconds // 60} minutes")
_STOPPED_BY_AN_ERROR = ProviderError(ProviderErrorKind.UNKNOWN, "The sync stopped because of an unexpected error")
_INTERRUPTED_TOO_OFTEN = ProviderError(ProviderErrorKind.UNKNOWN, f"The sync was interrupted {MAX_JOB_ATTEMPTS} times")


@contextlib.contextmanager
def _acting_as(user_id: uuid.UUID) -> Iterator[None]:
    """Work as a user, so every session opened inside stamps their identity for row-level security"""
    token = current_user_id_ctx.set(user_id)
    try:
        yield
    finally:
        current_user_id_ctx.reset(token)


async def enqueue_due_work() -> None:
    """Queue a scheduled sync for each connection due one, then stamp the heartbeat and prune old jobs

    The due list comes through a definer function, since only the worker sees across users, and
    each job is queued as its connection's owner, merging into any job already queued for it
    """
    now = datetime.now(UTC)
    async with async_session() as db:
        due = (await db.execute(text(f"SELECT connection_id, owner_id FROM {LIST_DUE_BANK_CONNECTIONS}(:now)"), {"now": now})).all()  # noqa: S608

    for connection_id, owner_id in due:
        with _acting_as(owner_id):
            async with async_session() as db:
                await enqueue_bank_sync_job(db, owner_id=owner_id, connection_id=connection_id, kind=BankSyncJobKind.SCHEDULED)
                await db.commit()

    async with async_session() as db:
        await db.execute(text(f"SELECT {RECORD_BANK_SYNC_SCAN}(:now)"), {"now": now})
        await db.commit()


async def run_jobs(max_jobs: int, deadline: datetime | None = None) -> int:
    """Claim and run due jobs one after another, and return how many were claimed

    Returns once max_jobs were claimed or none is due. Given a deadline, a job is claimed only while
    its time limit ends by then, so the call returns before the deadline, give or take the moment
    recording a failure takes, and leaves later jobs queued for the next call

    Args:
        max_jobs: Most jobs to claim
        deadline: When the caller must have returned, as an aware time, or None to have no limit
    """
    claimed = 0
    while claimed < max_jobs and (deadline is None or datetime.now(UTC) + JOB_TIME_LIMIT <= deadline):
        async with async_session() as db:
            job = await claim_bank_sync_job(db)
            await db.commit()
        if job is None:
            break
        claimed += 1
        await _run_claimed_job(job)
    return claimed


async def _run_claimed_job(job: ClaimedJob) -> None:
    """Run a claimed job as its owner within its time limit, recording it as failed when it can't finish"""
    with _acting_as(job.owner_id):
        if job.attempt > MAX_JOB_ATTEMPTS:
            logger.warning("Bank sync job %s was interrupted %d times, so it is recorded as failed", job.id, MAX_JOB_ATTEMPTS)
            await _fail_job(job, _INTERRUPTED_TOO_OFTEN)
            return

        try:
            async with asyncio.timeout(JOB_TIME_LIMIT.total_seconds()) as limit:
                await run_sync_job(job)
        except JobNotHeld:
            logger.info("Bank sync job %s attempt %d lost its lease, so what it found was discarded", job.id, job.attempt)
        except Exception:
            if limit.expired():
                logger.warning("Bank sync job %s ran past its time limit and was stopped", job.id)
                await _fail_job(job, _TIMED_OUT)
            else:
                # A job that fails is recorded as failed rather than stopping the jobs after it or
                # leaving it to be claimed again
                logger.exception("Bank sync job %s failed", job.id)
                await _fail_job(job, _STOPPED_BY_AN_ERROR)


async def _fail_job(job: ClaimedJob, error: ProviderError) -> None:
    """Record a job as failed, as long as this runner still holds it"""
    async with async_session() as db:
        try:
            await lock_job_for_finish(db, job, links=())
        except JobNotHeld:
            logger.info("Bank sync job %s attempt %d no longer held, so its failure isn't recorded", job.id, job.attempt)
            return
        await finish_job(db, job, error)
        await db.commit()


async def is_sync_worker_running(db: AsyncSession, now: datetime) -> bool:
    """Return whether a worker has scanned for due work recently enough to count as running

    Args:
        db: Any session, since the heartbeat describes the deployment rather than a user
        now: The current time
    """
    last_scan_at = await db.scalar(select(BankSyncHeartbeat.last_scan_at))
    return last_scan_at is not None and now - last_scan_at <= SYNC_STOPPED_AFTER
