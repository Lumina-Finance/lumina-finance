"""Running bank sync jobs: the two operations every runner calls, and the self-hosted worker's loop

Enqueueing due work and running jobs are each callable on their own and keep nothing between
calls, so the self-hosted worker's loop and a hosted runner on its own schedule share them. Each
sees across users only through the worker's definer functions, and runs everything else as the
owning user under row-level security
"""

import asyncio
import contextlib
import functools
import logging
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.config.bank_sync import BANK_SYNC_WORKER_CONCURRENCY
from app.database import async_session, current_user_id_ctx, engine, verify_app_role_is_unprivileged
from app.db.encryption_key import verify_key_matches_data
from app.db.rls.functions import LIST_DUE_BANK_CONNECTIONS, MIGRATION_REVISIONS, RECORD_BANK_SYNC_SCAN
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

# The self-hosted worker's fixed cadence: how often it scans for due work, how often it checks
# for a queued job while it has none to run, and how often it tries the database while waiting
# to start
_SCAN_INTERVAL = timedelta(minutes=5)
_CLAIM_INTERVAL = timedelta(seconds=5)
_START_RETRY_INTERVAL = timedelta(seconds=5)

_ALEMBIC_INI = Path(__file__).resolve().parents[3] / "alembic.ini"

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


async def check_worker_health() -> bool:
    """Return whether the heartbeat shows a worker scanning on time, for the worker container's health check

    The check runs as a process of its own, so this closes the database connections it opened
    """
    try:
        async with async_session() as db:
            return await is_sync_worker_running(db, datetime.now(UTC))
    finally:
        await engine.dispose()


async def run_worker() -> None:
    """Run the self-hosted worker until it is stopped

    Waits until the database is reachable and migrated, then scans for due work every 5 minutes
    while BANK_SYNC_WORKER_CONCURRENCY runners claim and run jobs. The claim never hands two
    runners jobs for one connection

    Raises:
        RuntimeError: Jobs would run as a role row-level security doesn't constrain, or the
            encryption key isn't the one the stored secrets are under
    """
    await _wait_for_database()
    await verify_app_role_is_unprivileged()
    async with engine.connect() as connection:
        await verify_key_matches_data(connection)

    logger.info("Bank sync worker started, running up to %d jobs at once", BANK_SYNC_WORKER_CONCURRENCY)
    async with asyncio.TaskGroup() as runners:
        runners.create_task(_scan_for_due_work())
        for _ in range(BANK_SYNC_WORKER_CONCURRENCY):
            runners.create_task(_run_jobs_in_turn())


async def is_database_migrated(connection: AsyncConnection) -> bool:
    """Return whether the database is migrated to exactly the revisions this release ships

    Args:
        connection: Connection as the app role, which reads the revisions through a definer function
    """
    revisions = await connection.scalars(text(f"SELECT {MIGRATION_REVISIONS}()"))
    return set(revisions) == _shipped_heads()


@functools.cache
def _shipped_heads() -> frozenset[str]:
    """Return the migration heads this release ships, read from its migration scripts"""
    return frozenset(ScriptDirectory.from_config(Config(str(_ALEMBIC_INI))).get_heads())


async def _wait_for_database() -> None:
    """Return once the database is reachable as the app role and migrated to this release

    On a fresh install the app's container creates the database roles and migrates while this
    waits, and after an upgrade it migrates before this release's worker claims anything. Each
    new reason for waiting is logged once
    """
    logged_reason = None
    while True:
        try:
            async with engine.connect() as connection:
                if await is_database_migrated(connection):
                    return
            reason = "the database isn't migrated to this release yet"
        except (OSError, DBAPIError) as error:
            reason = f"the database can't be used yet: {getattr(error, 'orig', error)}"
        if reason != logged_reason:
            logger.info("Bank sync worker waiting to start: %s", reason)
            logged_reason = reason
        await asyncio.sleep(_START_RETRY_INTERVAL.total_seconds())


async def _scan_for_due_work() -> None:
    """Scan for due work now and every 5 minutes after, carrying on past a scan that fails"""
    while True:
        try:
            await enqueue_due_work()
        except Exception:
            # Best effort: the next scan finds the same connections due, and a worker that keeps
            # failing shows as sync not running once the heartbeat goes stale
            logger.exception("Scanning for due bank syncs failed")
        await asyncio.sleep(_SCAN_INTERVAL.total_seconds())


async def _run_jobs_in_turn() -> None:
    """Run due jobs one after another, checking again every 5 seconds while none is due"""
    while True:
        try:
            ran = await run_jobs(1)
        except Exception:
            # Best effort: a job whose failure couldn't be recorded is claimed again once its
            # lease runs out, so the runner carries on rather than stopping the worker
            logger.exception("Claiming a bank sync job failed")
            ran = 0
        if not ran:
            await asyncio.sleep(_CLAIM_INTERVAL.total_seconds())
