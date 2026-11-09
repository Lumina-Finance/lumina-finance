"""Running bank sync jobs: the two operations every runner calls, and the worker's loop

Enqueueing due work and running jobs are each callable on their own and keep nothing between
calls, so the worker's loop calls each on a cadence of its own, and so can any other caller. Each
sees across users only through the worker's definer functions, and runs everything else as the
owning user under row-level security
"""

import asyncio
import contextlib
import functools
import logging
import signal
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config.bank_sync import BANK_SYNC_WORKER_CONCURRENCY
from app.database import async_session, current_user_id_ctx, engine, verify_app_role_is_unprivileged
from app.db.encryption_key import verify_key_matches_data
from app.db.rls.functions import LIST_DUE_BANK_CONNECTIONS, MIGRATION_REVISIONS, RECORD_BANK_SYNC_SCAN
from app.models import import_all_models
from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.availability import enabled_adapters
from app.services.bank_sync.heartbeat import is_sync_worker_running
from app.services.bank_sync.jobs import ClaimedJob, JobNotHeld, claim_bank_sync_job
from app.services.bank_sync.providers.contract import ProviderError
from app.services.bank_sync.providers.registry import run_startup_checks
from app.services.bank_sync.schedule import queue_scheduled_sync
from app.services.bank_sync.sync import fail_sync_job, run_sync_job
from app.services.email import build_email_sender, get_email_sender, set_email_sender

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

# The worker's fixed cadence: how often it scans for due work, how often it checks
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
    """Queue a scheduled sync for each connection due one, then stamp the heartbeat

    The due list comes through a definer function, since only the worker sees across users, and
    each sync is queued as its connection's owner, for once a request is free, merging into any job
    already queued for it, as the schedule module describes. A connection that fails to queue is
    logged and skipped, so the rest are still queued and the heartbeat still stamped
    """
    now = datetime.now(UTC)
    async with async_session() as db:
        due = (await db.execute(text(f"SELECT connection_id, owner_id FROM {LIST_DUE_BANK_CONNECTIONS}(:now)"), {"now": now})).all()  # noqa: S608

    for connection_id, owner_id in due:
        try:
            with _acting_as(owner_id):
                async with async_session() as db:
                    await queue_scheduled_sync(db, connection_id, now=now)
                    await db.commit()
        except Exception:
            # Best effort per connection: one that can't be queued is listed due again at the next
            # scan, and stopping here would leave every later owner unsynced and the heartbeat stale
            logger.exception("Queueing a scheduled sync of bank connection %s failed", connection_id)

    await _stamp_heartbeat(now)


async def _stamp_heartbeat(now: datetime) -> None:
    """Stamp the heartbeat the provider list and the worker's health check read"""
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

    Raises:
        RuntimeError: No email sender is installed, found before any job is claimed, since every
            action-needed email the jobs started would otherwise be lost
    """
    get_email_sender()

    # A job's flush resolves foreign keys to tables nothing the sync imports declares, such as the
    # import runs a ledger transaction points to. The app's routes load every model between them, and
    # neither runner of jobs has any
    import_all_models()
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
    started_at = datetime.now(UTC)
    with _acting_as(job.owner_id):
        if job.attempt > MAX_JOB_ATTEMPTS:
            logger.warning("Bank sync job %s was interrupted %d times, so it is recorded as failed", job.id, MAX_JOB_ATTEMPTS)
            await _fail_job(job, _INTERRUPTED_TOO_OFTEN, started_at=started_at)
            return

        try:
            async with asyncio.timeout(JOB_TIME_LIMIT.total_seconds()) as limit:
                await run_sync_job(job)
        except JobNotHeld:
            logger.info("Bank sync job %s attempt %d lost its lease, so what it found was discarded", job.id, job.attempt)
        except Exception:
            if limit.expired():
                logger.warning("Bank sync job %s ran past its time limit and was stopped", job.id)
                await _fail_job(job, _TIMED_OUT, started_at=started_at)
            else:
                # A job that fails is recorded as failed rather than stopping the jobs after it or
                # leaving it to be claimed again
                logger.exception("Bank sync job %s failed", job.id)
                await _fail_job(job, _STOPPED_BY_AN_ERROR, started_at=started_at)


async def _fail_job(job: ClaimedJob, error: ProviderError, *, started_at: datetime) -> None:
    """Record a job as failed, and the attempt of each link it was syncing, as long as this runner still holds it"""
    try:
        await fail_sync_job(job, error, started_at=started_at)
    except JobNotHeld:
        logger.info("Bank sync job %s attempt %d no longer held, so its failure isn't recorded", job.id, job.attempt)


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
    """Run the worker until it is stopped

    Waits until the database is reachable and migrated, then scans for due work every 5 minutes
    while BANK_SYNC_WORKER_CONCURRENCY runners claim and run jobs. The claim never hands two
    runners jobs for one connection. On SIGTERM or SIGINT it claims no more jobs, lets each job
    already running finish within its time limit, and returns. Jobs send their action-needed
    emails through the sender EMAIL_BACKEND names, as the app sends its own

    Raises:
        RuntimeError: Jobs would run as a role row-level security doesn't constrain, the
            encryption key isn't the one the stored secrets are under, or EMAIL_BACKEND names an
            unknown backend
    """
    run_startup_checks()
    set_email_sender(build_email_sender())
    await _wait_for_database()
    await verify_app_role_is_unprivileged()
    async with engine.connect() as connection:
        await verify_key_matches_data(connection)

    # Installed once the start-up checks have passed, since a stop before then has no job to protect
    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for stop_signal in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(stop_signal, stopping.set)

    # With no provider enabled there is nothing to sync. A worker in a container of its own stays up
    # and keeps its heartbeat, so its health check passes rather than the container restarting
    syncing = bool(enabled_adapters())
    if syncing:
        logger.info("Bank sync worker started, running up to %d jobs at once", BANK_SYNC_WORKER_CONCURRENCY)
    else:
        logger.info("Bank sync worker idle: no bank provider is enabled, so it only keeps its heartbeat")
    try:
        async with asyncio.TaskGroup() as runners:
            if not syncing:
                runners.create_task(_keep_heartbeat(stopping))
            else:
                runners.create_task(_scan_for_due_work(stopping))
                for _ in range(BANK_SYNC_WORKER_CONCURRENCY):
                    runners.create_task(_run_jobs_in_turn(stopping))
    finally:
        await engine.dispose()
    logger.info("Bank sync worker stopped")


async def is_database_migrated(connection: AsyncConnection) -> bool:
    """Return whether the database is migrated to exactly the revisions this release ships

    Args:
        connection: Connection as the app role. It reads the revisions through a definer function
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


async def _sleep_unless_stopping(stopping: asyncio.Event, interval: timedelta) -> None:
    """Wait out the interval, or return as soon as the worker is asked to stop"""
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stopping.wait(), interval.total_seconds())


async def _scan_for_due_work(stopping: asyncio.Event) -> None:
    """Scan for due work now and every 5 minutes after, carrying on past a scan that fails, until asked to stop"""
    while not stopping.is_set():
        try:
            await enqueue_due_work()
        except Exception:
            # Best effort: the next scan finds the same connections due, and a worker that keeps
            # failing shows as sync not running once the heartbeat goes stale
            logger.exception("Scanning for due bank syncs failed")
        await _sleep_unless_stopping(stopping, _SCAN_INTERVAL)


async def _keep_heartbeat(stopping: asyncio.Event) -> None:
    """Stamp the heartbeat now and at each scan after, carrying on past a stamp that fails, until asked to stop"""
    while not stopping.is_set():
        try:
            await _stamp_heartbeat(datetime.now(UTC))
        except Exception:
            # Best effort, as a scan is: the next stamp tries again
            logger.exception("Stamping the bank sync heartbeat failed")
        await _sleep_unless_stopping(stopping, _SCAN_INTERVAL)


async def _run_jobs_in_turn(stopping: asyncio.Event) -> None:
    """Run due jobs one after another, checking again every 5 seconds while none is due

    Once asked to stop it claims no more jobs, and the job it is running finishes first, within its
    time limit
    """
    while not stopping.is_set():
        try:
            ran = await run_jobs(1)
        except Exception:
            # Best effort: a job whose failure couldn't be recorded is claimed again once its
            # lease runs out, so the runner carries on rather than stopping the worker
            logger.exception("Claiming a bank sync job failed")
            ran = 0
        if not ran:
            await _sleep_unless_stopping(stopping, _CLAIM_INTERVAL)
