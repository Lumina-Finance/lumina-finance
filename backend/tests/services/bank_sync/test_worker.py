"""The bank sync worker's two operations: enqueueing due work, and claiming and running jobs

Each is called on its own here, as the worker's loop calls them, against jobs committed where the
worker's own sessions see them. A runner stand-in takes the place of the sync itself where a test
needs a job to wait as though fetching, or to write what it found inside the job's fence. Without
the fence a job that lost its lease would overwrite the next attempt's results, and an account
unlinked mid-fetch would still get pending items, and a job that fails without its links recording
why leaves their accounts looking fine and never retried. A due connection that fails to queue is
logged and left for the next scan, so it can't stop the other owners' syncs or the heartbeat. The
heartbeat and what the worker needs before it starts are covered last
"""

import asyncio
import contextlib
import json
import os
import signal
import subprocess
import sys
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text, update

from app.config.bank_sync import provider_setting_key
from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncHeartbeat, BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.models.base import Base
from app.models.user import User
from app.services.bank_sync import worker
from app.services.bank_sync.jobs import ClaimedJob, finish_job, lock_covered_links, lock_held_job
from app.services.bank_sync.links import disconnect_connection, unlink_account
from app.services.bank_sync.pending import replace_pending_transactions
from app.services.bank_sync.providers.registry import load_adapters
from app.services.bank_sync.schedule import queue_scheduled_sync
from app.services.bank_sync.sync import run_sync_job
from app.services.bank_sync.worker import MAX_JOB_ATTEMPTS, enqueue_due_work, run_jobs
from app.services.email import contract as email_contract
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import (
    _attempts,
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_pending_transaction,
    _expire_lease,
    _job_states,
    _queued_jobs,
    _seed_job,
)
from tests.routes.support.identity_helpers import _act_as
from tests.services.bank_sync.fake_provider import remove_provider

# Long enough for any step here to finish, so a missing protection fails the test rather than hanging it
_WAIT_SECONDS = 10

_BACKEND_DIR = Path(__file__).resolve().parents[3]

pytestmark = pytest.mark.usefixtures("worker_sessions")


class _FetchingRunner:
    """Stands in for a sync of a connection's active links, writing a pending item for each it may still write for

    An attempt named in held waits after reading its links, as a job waits on the provider, until the
    test releases it, and one named in failing then raises instead of writing. The item it writes
    names its attempt, and every run is recorded by job and attempt
    """

    def __init__(
        self,
        accounts: Sequence[Account] = (),
        held: Sequence[tuple[uuid.UUID, int]] = (),
        failing: Sequence[tuple[uuid.UUID, int]] = (),
    ) -> None:
        """Write for these accounts, hold these attempts of these jobs mid-fetch, and fail these"""
        self.accounts = {account.id: account for account in accounts}
        self.fetching = {attempt: asyncio.Event() for attempt in held}
        self.release = {attempt: asyncio.Event() for attempt in held}
        self.failing = set(failing)
        self.runs: list[tuple[uuid.UUID, int]] = []

    async def __call__(self, job: ClaimedJob) -> None:
        """Read the links, wait if held, then fail or write inside the job's fence"""
        attempt = (job.id, job.attempt)
        self.runs.append(attempt)
        async with ScopedSession() as db:
            links = (
                await db.scalars(
                    select(BankAccountLink).where(
                        BankAccountLink.connection_id == job.connection_id, BankAccountLink.state == BankLinkState.ACTIVE
                    )
                )
            ).all()
        if attempt in self.fetching:
            self.fetching[attempt].set()
            await self.release[attempt].wait()
        if attempt in self.failing:
            raise RuntimeError("Unexpected bank data")

        async with ScopedSession() as db:
            await lock_held_job(db, job)
            for link in await lock_covered_links(db, links):
                await replace_pending_transactions(
                    db, link.account_id, [_build_pending_transaction(self.accounts[link.account_id], f"HOLD-{job.attempt}")]
                )
            await finish_job(db, job)
            await db.commit()


async def _seed_links(connection: BankConnection, *external_ids: str) -> tuple[list[Account], list[BankAccountLink]]:
    """Commit one of the owner's accounts linked to each bank account on a connection"""
    accounts = [_build_account(connection.owner_id, name=f"Account {external_id}") for external_id in external_ids]
    links = [_build_bank_link(account, connection, external_id) for account, external_id in zip(accounts, external_ids, strict=True)]
    async with TestSession() as session:
        session.add_all(accounts)
        await session.flush()
        session.add_all(links)
        await session.commit()
    return accounts, links


async def _pending_items() -> set[tuple[uuid.UUID, str]]:
    """Return each pending item's account and description"""
    async with TestSession() as session:
        rows = (await session.execute(select(BankPendingTransaction.account_id, BankPendingTransaction.description))).all()
    return {tuple(row) for row in rows}


async def _job_outcomes() -> dict:
    """Return every job's status and the kind of error recorded for it by id"""
    async with TestSession() as session:
        rows = (await session.execute(select(BankSyncJob.id, BankSyncJob.status, BankSyncJob.last_error_kind))).all()
    return {job_id: (status, kind) for job_id, status, kind in rows}


async def test_run_jobs_called_at_once_run_each_owners_job_as_that_owner(connections, monkeypatch):
    """Two runs going at once each take a different owner's job and see only that owner's data"""
    jobs = [await _seed_job(connection, BankSyncJobKind.SCHEDULED) for connection in connections[:2]]
    both_running = asyncio.Barrier(2)
    seen_owners = {}

    async def runner(job: ClaimedJob) -> None:
        """Wait until both jobs are running, then read connections as the job's owner"""
        await both_running.wait()
        async with ScopedSession() as db:
            seen_owners[job.id] = (await db.scalars(select(BankConnection.owner_id))).all()
        await run_sync_job(job)

    monkeypatch.setattr(worker, "run_sync_job", runner)

    async with asyncio.timeout(_WAIT_SECONDS):
        claimed = await asyncio.gather(run_jobs(1), run_jobs(1))

    assert claimed == [1, 1]
    assert seen_owners == {job.id: [connection.owner_id] for job, connection in zip(jobs, connections[:2], strict=True)}
    assert await _job_states() == {job.id: ("succeeded", 1) for job in jobs}


@pytest.mark.parametrize("late_outcome", ["finishes", "fails"])
async def test_run_jobs_attempt_whose_lease_ran_out_changes_nothing_when_it_ends_during_the_next_attempt(
    connections, monkeypatch, late_outcome
):
    """A worker restarting mid-fetch loses the job to attempt 2, and attempt 1 ending while attempt 2 still fetches changes nothing

    Attempt 1 ends while the job is still running, so only the attempt number keeps its results, or
    its failure on the link it was syncing, from landing on attempt 2's job
    """
    connection = connections[0]
    accounts, (link,) = await _seed_links(connection, "ACT-1")
    job = await _seed_job(connection, BankSyncJobKind.SCHEDULED, covered_link_ids=[link.id])
    untouched = [(None, None, None, 0, None)]
    first, second = (job.id, 1), (job.id, 2)
    runner = _FetchingRunner(accounts, held=[first, second], failing=[first] if late_outcome == "fails" else [])
    monkeypatch.setattr(worker, "run_sync_job", runner)

    async with asyncio.timeout(_WAIT_SECONDS):
        first_runner = asyncio.create_task(run_jobs(1))
        await runner.fetching[first].wait()
        await _expire_lease(job)
        second_runner = asyncio.create_task(run_jobs(1))
        await runner.fetching[second].wait()
        runner.release[first].set()
        assert await first_runner == 1

        assert await _pending_items() == set()
        assert await _job_states() == {job.id: ("running", 2)}
        assert await _attempts(link) == untouched
        assert await _queued_jobs() == []

        runner.release[second].set()
        assert await second_runner == 1

    assert await _pending_items() == {(accounts[0].id, "HOLD-2")}
    assert await _job_states() == {job.id: ("succeeded", 2)}
    assert await _attempts(link) == untouched
    assert await _queued_jobs() == []


@pytest.mark.parametrize(
    "change",
    [
        lambda spare: {"state": BankLinkState.UNLINKED, "unlinked_at": datetime.now(UTC)},
        lambda spare: {"state": BankLinkState.CHOOSE_ACCOUNT},
        lambda spare: {"external_account_id": "ACT-9"},
        lambda spare: {"connection_id": spare.id},
    ],
    ids=["unlinked", "waiting_to_choose_the_bank_account", "moved_to_another_bank_account", "moved_to_another_connection"],
)
async def test_job_finishing_after_a_link_changed_mid_fetch_writes_nothing_for_that_account(connections, monkeypatch, change):
    """Savings changed while its connection's job fetched gets no pending items, and Everyday still does"""
    connection = connections[0]
    spare = _build_bank_connection(connection.owner_id)
    async with TestSession() as session:
        session.add(spare)
        await session.commit()
    (everyday, savings), (_, savings_link) = await _seed_links(connection, "ACT-1", "ACT-2")
    job = await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    runner = _FetchingRunner([everyday, savings], held=[(job.id, 1)])
    monkeypatch.setattr(worker, "run_sync_job", runner)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await runner.fetching[(job.id, 1)].wait()
        async with TestSession() as session:
            await session.execute(update(BankAccountLink).where(BankAccountLink.id == savings_link.id).values(change(spare)))
            await session.commit()
        runner.release[(job.id, 1)].set()
        await running

    assert await _pending_items() == {(everyday.id, "HOLD-1")}
    assert await _job_states() == {job.id: ("succeeded", 1)}


@pytest.mark.parametrize("ending", ["unlink_savings", "disconnect"])
async def test_job_finishing_after_an_unlink_or_disconnect_mid_fetch_writes_nothing_for_those_accounts(connections, monkeypatch, ending):
    """Savings unlinked while the job fetched gets nothing and Everyday's results are kept. After a disconnect neither gets anything"""
    connection = connections[0]
    (everyday, savings), _ = await _seed_links(connection, "ACT-1", "ACT-2")
    job = await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    runner = _FetchingRunner([everyday, savings], held=[(job.id, 1)])
    monkeypatch.setattr(worker, "run_sync_job", runner)
    async with TestSession() as session:
        owner = await session.get_one(User, connection.owner_id)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await runner.fetching[(job.id, 1)].wait()
        async with _act_as(owner.id) as db:
            if ending == "disconnect":
                await disconnect_connection(db, owner, connection.id)
            else:
                await unlink_account(db, owner, savings.id)
        runner.release[(job.id, 1)].set()
        await running

    if ending == "disconnect":
        assert (await _pending_items(), await _job_states()) == (set(), {})
    else:
        assert (await _pending_items(), await _job_states()) == ({(everyday.id, "HOLD-1")}, {job.id: ("succeeded", 1)})


async def test_runner_asked_to_stop_finishes_its_job_and_claims_no_other(connections, monkeypatch):
    """Stopping while the first connection's job fetches lets that job finish and leaves the second connection's job queued"""
    first = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED)
    second = await _seed_job(connections[1], BankSyncJobKind.SCHEDULED)
    runner = _FetchingRunner(held=[(first.id, 1)])
    monkeypatch.setattr(worker, "run_sync_job", runner)
    stopping = asyncio.Event()

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(worker._run_jobs_in_turn(stopping))
        await runner.fetching[(first.id, 1)].wait()
        stopping.set()
        runner.release[(first.id, 1)].set()
        await running

    assert await _job_states() == {first.id: ("succeeded", 1), second.id: ("queued", 0)}


async def test_scan_for_due_work_asked_to_stop_returns_at_once(monkeypatch):
    """A scan sleeping until its next round wakes and returns when the worker is asked to stop"""
    scanned = asyncio.Event()

    async def scan() -> None:
        """Note the scan happened"""
        scanned.set()

    monkeypatch.setattr(worker, "enqueue_due_work", scan)
    stopping = asyncio.Event()

    async with asyncio.timeout(_WAIT_SECONDS):
        scanning = asyncio.create_task(worker._scan_for_due_work(stopping))
        await scanned.wait()
        stopping.set()
        await scanning


async def test_worker_stops_on_sigterm_once_its_runners_have_finished(monkeypatch):
    """SIGTERM (Docker sends it on a stop or an upgrade) ends the worker rather than killing it mid-job"""
    handlers = {}
    scanned = asyncio.Event()

    async def scan() -> None:
        """Note the scan happened"""
        scanned.set()

    async def nothing(*_) -> None:
        """Stand in for a start-up check"""

    @contextlib.asynccontextmanager
    async def connect():
        """Stand in for a database connection"""
        yield None

    loop = asyncio.get_running_loop()
    monkeypatch.setattr(loop, "add_signal_handler", lambda sig, callback, *args: handlers.__setitem__(sig, callback))
    monkeypatch.setattr(worker, "enqueue_due_work", scan)
    monkeypatch.setattr(worker, "_wait_for_database", nothing)
    monkeypatch.setattr(worker, "verify_app_role_is_unprivileged", nothing)
    monkeypatch.setattr(worker, "verify_key_matches_data", nothing)
    monkeypatch.setattr(worker, "engine", SimpleNamespace(connect=connect, dispose=nothing))

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(worker.run_worker())
        await scanned.wait()
        handlers[signal.SIGTERM]()
        await running


async def test_worker_with_no_provider_enabled_keeps_its_heartbeat_and_claims_nothing(monkeypatch, frozen_now):
    """A worker container on a server offering no bank provider stays healthy without scanning or claiming"""
    handlers = {}
    stamped = asyncio.Event()
    stamp = worker._stamp_heartbeat

    async def stamp_and_note(now: datetime) -> None:
        """Stamp the heartbeat, then note it happened"""
        await stamp(now)
        stamped.set()

    async def refuse(*_) -> int:
        """Stand in for scanning and claiming, which an idle worker never does"""
        raise AssertionError("an idle worker scanned or claimed")

    async def nothing(*_) -> None:
        """Stand in for a start-up check"""

    @contextlib.asynccontextmanager
    async def connect():
        """Stand in for a database connection"""
        yield None

    remove_provider(monkeypatch, "fake")
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(loop, "add_signal_handler", lambda sig, callback, *args: handlers.__setitem__(sig, callback))
    monkeypatch.setattr(worker, "_stamp_heartbeat", stamp_and_note)
    monkeypatch.setattr(worker, "enqueue_due_work", refuse)
    monkeypatch.setattr(worker, "run_jobs", refuse)
    monkeypatch.setattr(worker, "_wait_for_database", nothing)
    monkeypatch.setattr(worker, "verify_app_role_is_unprivileged", nothing)
    monkeypatch.setattr(worker, "verify_key_matches_data", nothing)
    monkeypatch.setattr(worker, "engine", SimpleNamespace(connect=connect, dispose=nothing))

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(worker.run_worker())
        await stamped.wait()
        handlers[signal.SIGTERM]()
        await running

    async with TestSession() as session:
        assert await session.scalar(select(BankSyncHeartbeat.last_scan_at)) == frozen_now


@pytest.mark.parametrize(
    ("enabled", "status"),
    [("false", os.EX_UNAVAILABLE), ("true", 0)],
    ids=["none_enabled", "one_enabled"],
)
def test_check_providers_says_whether_the_app_container_should_start_a_worker(enabled, status):
    """The app's container starts its worker only when the check passes, so a server with no provider runs none"""
    switches = {provider_setting_key(provider_id, "ENABLED"): "false" for provider_id in load_adapters()}
    first = min(load_adapters())
    completed = subprocess.run(
        [sys.executable, "-m", "app.worker", "check-providers"],
        cwd=_BACKEND_DIR,
        env={**os.environ, **switches, provider_setting_key(first, "ENABLED"): enabled},
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == status, completed.stderr


@pytest.mark.parametrize(
    ("max_jobs", "time_left", "claimed"),
    [
        (2, None, 2),
        (10, timedelta(minutes=5) - timedelta(seconds=1), 0),
        (10, timedelta(minutes=5), 3),
    ],
    ids=["stops_at_its_job_count", "deadline_under_5_minutes_away", "deadline_5_minutes_away"],
)
async def test_run_jobs_claims_no_more_than_its_count_and_nothing_that_could_run_past_its_deadline(
    connections, frozen_now, max_jobs, time_left, claimed
):
    """A call returns within its job count and deadline and leaves the rest queued for the next call

    A job may run for 5 minutes, so one is claimed only while the deadline is at least that far off
    """
    for connection in connections[:3]:
        await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    deadline = None if time_left is None else frozen_now + time_left

    assert await run_jobs(max_jobs, deadline) == claimed

    assert sorted(status for status, _ in (await _job_states()).values()) == ["queued"] * (3 - claimed) + ["succeeded"] * claimed


async def test_run_jobs_without_an_email_sender_claims_no_job(connections, monkeypatch):
    """A runner with no sender installed stops before claiming, rather than running jobs whose action-needed emails would all be lost"""
    monkeypatch.setattr(email_contract, "_active_sender", None)
    job = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED)

    with pytest.raises(RuntimeError, match="No email sender installed"):
        await run_jobs(1)

    assert await _job_states() == {job.id: ("queued", 0)}


@pytest.mark.parametrize(
    ("attempts_so_far", "runs_again"),
    [(MAX_JOB_ATTEMPTS - 1, True), (MAX_JOB_ATTEMPTS, False)],
    ids=["interrupted_twice", "interrupted_three_times"],
)
async def test_run_jobs_gives_up_on_a_job_interrupted_three_times_and_runs_the_queued_one(
    connections, monkeypatch, attempts_so_far, runs_again
):
    """A job whose runner keeps stopping mid-job runs a third time, then fails rather than hold back the connection"""
    lapsed = datetime.now(UTC) - timedelta(minutes=1)
    interrupted = await _seed_job(
        connections[0], BankSyncJobKind.SCHEDULED, status=BankSyncJobStatus.RUNNING, attempt=attempts_so_far, lease_expires_at=lapsed
    )
    queued = await _seed_job(connections[0], BankSyncJobKind.MANUAL)
    runner = _FetchingRunner()
    monkeypatch.setattr(worker, "run_sync_job", runner)

    assert await run_jobs(10) == 2

    if runs_again:
        assert runner.runs == [(interrupted.id, MAX_JOB_ATTEMPTS), (queued.id, 1)]
        assert (await _job_outcomes())[interrupted.id] == ("succeeded", None)
    else:
        assert runner.runs == [(queued.id, 1)]
        assert (await _job_outcomes())[interrupted.id] == ("failed", "unknown")
    assert (await _job_outcomes())[queued.id] == ("succeeded", None)


@pytest.mark.parametrize(("failure", "kind"), [("raises", "unknown"), ("hangs", "temporary")])
async def test_run_jobs_records_a_job_that_fails_and_runs_the_next(connections, monkeypatch, job_time_limits, failure, kind):
    """A job that raises or runs past its time limit is recorded as failed, and the next job still runs"""
    failing = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED)
    following = await _seed_job(connections[1], BankSyncJobKind.SCHEDULED)

    async def runner(job: ClaimedJob) -> None:
        """Fail the first connection's job, hanging until its time limit ends (the runner ends it at once), and run the other"""
        if job.id == failing.id:
            if failure == "raises":
                raise RuntimeError("Unexpected bank data")
            job_time_limits.end_running()
            await asyncio.Event().wait()
        await run_sync_job(job)

    monkeypatch.setattr(worker, "run_sync_job", runner)

    async with asyncio.timeout(_WAIT_SECONDS):
        assert await run_jobs(10) == 2

    assert await _job_outcomes() == {failing.id: ("failed", kind), following.id: ("succeeded", None)}


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        ("raises", "The sync stopped because of an unexpected error"),
        ("interrupted_too_often", "The sync was interrupted 3 times"),
    ],
)
async def test_run_jobs_records_why_a_job_failed_on_each_link_it_was_syncing_and_retries_them(
    connections, monkeypatch, frozen_now, failure, reason
):
    """The job was syncing Everyday when it failed, so Everyday shows why and is retried 30 minutes on, and Savings shows no attempt

    A job that raises fails after it ran, and one interrupted too often fails before it runs
    """
    _, (everyday, savings) = await _seed_links(connections[0], "ACT-everyday", "ACT-savings")
    values = {"covered_link_ids": [everyday.id]}
    if failure == "interrupted_too_often":
        lapsed = frozen_now - timedelta(minutes=1)
        values |= {"status": BankSyncJobStatus.RUNNING, "attempt": MAX_JOB_ATTEMPTS, "lease_expires_at": lapsed}
    job = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, **values)

    async def runner(job: ClaimedJob) -> None:
        """Fail the way an unexpected bug does"""
        raise RuntimeError("Unexpected bank data")

    monkeypatch.setattr(worker, "run_sync_job", runner)

    async with asyncio.timeout(_WAIT_SECONDS):
        assert await run_jobs(1) == 1

    assert await _attempts(everyday, savings) == [
        (None, frozen_now, reason, 1, frozen_now + timedelta(minutes=30)),
        (None, None, None, 0, None),
    ]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]
    assert (await _job_outcomes())[job.id][0] == "failed"


async def test_enqueue_due_work_queues_each_due_connection_as_its_owner_and_stamps_the_heartbeat(connections, frozen_now):
    """Two owners' connections past their next sync get a scheduled job each, and one not yet due gets none, all listed a day ago"""
    async with TestSession() as session:
        await session.execute(update(BankConnection).values(discovered_at=frozen_now - timedelta(days=1)))
        for connection, next_sync_at in (
            (connections[0], frozen_now - timedelta(minutes=5)),
            (connections[1], frozen_now - timedelta(days=2)),
            (connections[2], frozen_now + timedelta(minutes=5)),
        ):
            (await session.get(BankConnection, connection.id)).next_sync_at = next_sync_at
        await session.commit()

    await enqueue_due_work()

    async with TestSession() as session:
        jobs = (await session.execute(select(BankSyncJob.connection_id, BankSyncJob.owner_id, BankSyncJob.kind, BankSyncJob.status))).all()
        last_scan_at = await session.scalar(select(BankSyncHeartbeat.last_scan_at))
    assert sorted(tuple(job) for job in jobs) == sorted(
        (connection.id, connection.owner_id, "scheduled", "queued") for connection in connections[:2]
    )
    assert last_scan_at == frozen_now


async def test_enqueue_due_work_logs_and_skips_a_connection_that_fails_and_queues_the_rest(connections, frozen_now, monkeypatch, caplog):
    """Three owners' connections are due, and queueing the first one scanned fails in the database

    That one is logged and left for the next scan, the other two get their scheduled jobs and the
    heartbeat is stamped, so one broken connection can't stop every owner's syncs or show sync as down
    """
    async with TestSession() as session:
        await session.execute(update(BankConnection).values(discovered_at=frozen_now - timedelta(days=1)))
        await session.execute(
            update(BankConnection)
            .where(BankConnection.id.in_([connection.id for connection in connections[:3]]))
            .values(next_sync_at=frozen_now - timedelta(minutes=5))
        )
        await session.commit()
    failed: list[uuid.UUID] = []

    async def _fail_the_first(db, connection_id, *, now):
        """Fail in the database for the first connection, and queue the others as the scan would"""
        if not failed:
            failed.append(connection_id)
            await db.execute(text("SELECT 1 / 0"))
        await queue_scheduled_sync(db, connection_id, now=now)

    monkeypatch.setattr(worker, "queue_scheduled_sync", _fail_the_first)

    await enqueue_due_work()

    async with TestSession() as session:
        queued = set(await session.scalars(select(BankSyncJob.connection_id)))
        last_scan_at = await session.scalar(select(BankSyncHeartbeat.last_scan_at))
    assert queued == {connection.id for connection in connections[:3]} - set(failed)
    assert last_scan_at == frozen_now
    logged = [record for record in caplog.records if record.name == worker.logger.name]
    assert [(record.levelname, record.args, record.exc_info is not None) for record in logged] == [("ERROR", (failed[0],), True)]


async def test_enqueue_due_work_with_nothing_due_still_stamps_the_heartbeat(frozen_now):
    """A fresh install with no connections still shows sync running, so connecting a bank isn't disabled"""
    await enqueue_due_work()

    async with TestSession() as session:
        assert (await session.execute(select(BankSyncJob.id))).all() == []
        assert await session.scalar(select(BankSyncHeartbeat.last_scan_at)) == frozen_now


def test_worker_imports_without_the_token_signing_keys():
    """The worker container is never given the app's sign-in keys, so nothing a job runs may load them

    Cache change records are what a job's writes will reach the app's caches through, so their
    module is imported too. A clean interpreter is what makes this meaningful, since this process
    loaded the keys long ago
    """
    missing_keys = {"JWT_ACCESS_PRIVATE_KEY_PATH": "/nonexistent/access.pem", "JWT_REFRESH_PRIVATE_KEY_PATH": "/nonexistent/refresh.pem"}
    completed = subprocess.run(
        [sys.executable, "-c", "import app.worker, app.services.bank_sync.worker, app.services.cache_state"],
        cwd=_BACKEND_DIR,
        env={**os.environ, **missing_keys},
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr


# Calls run_jobs in a clean interpreter, as the worker process does, with a claim that prints the tables
# the metadata holds when it is made and finds nothing due. A session that never connects stands in
_WORKER_TABLES_SCRIPT = """
import asyncio, contextlib, json
from types import SimpleNamespace
from app.models.base import Base
from app.services.bank_sync import worker
from app.services.email import set_email_sender
from app.services.email.senders import LoggingEmailSender

async def commit():
    pass

@contextlib.asynccontextmanager
async def session():
    yield SimpleNamespace(commit=commit)

async def claim_nothing(_db):
    print(json.dumps(sorted(Base.metadata.tables)))

set_email_sender(LoggingEmailSender())
worker.async_session = session
worker.claim_bank_sync_job = claim_nothing
asyncio.run(worker.run_jobs(1))
"""


def test_worker_registers_every_table_before_running_jobs():
    """A job changing the ledger fails unless its runner has every model, since flushing needs them all

    An auto-approved correction changes a ledger transaction. Its flush resolves its foreign key to
    the import runs, and nothing the sync imports declares them. The worker runs every job through
    run_jobs. A clean interpreter is what makes this meaningful, since this process registered every
    model long ago
    """
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-c", _WORKER_TABLES_SCRIPT],
        cwd=_BACKEND_DIR,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert set(json.loads(completed.stdout)) == set(Base.metadata.tables)
