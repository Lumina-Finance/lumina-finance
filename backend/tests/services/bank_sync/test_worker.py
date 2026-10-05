"""The bank sync worker's two operations: enqueueing due work, and claiming and running jobs

Each is called on its own here, the way a hosted runner calls them, against jobs committed where the
worker's own sessions see them. A runner stand-in takes the place of the sync itself where a test
needs a job to wait as though fetching, or to write what it found inside the job's fence. Without
the fence a job that lost its lease would overwrite the next attempt's results, and an account
unlinked mid-fetch would still get pending items. The heartbeat and what the self-hosted worker
needs before it starts are covered last
"""

import asyncio
import os
import subprocess
import sys
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState, BankProvider
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncHeartbeat, BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.services.bank_sync import availability, worker
from app.services.bank_sync.jobs import ClaimedJob, finish_job, lock_job_for_finish
from app.services.bank_sync.pending import replace_pending_transactions
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from app.services.bank_sync.sync import run_sync_job
from app.services.bank_sync.worker import MAX_JOB_ATTEMPTS, enqueue_due_work, run_jobs
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_pending_transaction,
    _expire_lease,
    _job_states,
    _seed_job,
)

# Long enough for any step here to finish, so a missing protection fails the test rather than hanging it
_WAIT_SECONDS = 10

_BACKEND_DIR = Path(__file__).resolve().parents[3]

pytestmark = pytest.mark.usefixtures("worker_sessions", "simplefin_enabled")


@pytest.fixture
def simplefin_enabled(monkeypatch) -> None:
    """Serve SimpleFIN whatever this deployment's setting, since the jobs here run the real job runner on SimpleFIN connections"""
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, SimpleFinAdapter())


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
            for link in await lock_job_for_finish(db, job, links):
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
    """Return each pending item's account and bank id"""
    async with TestSession() as session:
        rows = (await session.execute(select(BankPendingTransaction.account_id, BankPendingTransaction.external_transaction_id))).all()
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
    its failure, from landing on attempt 2's job
    """
    connection = connections[0]
    accounts, _ = await _seed_links(connection, "ACT-1")
    job = await _seed_job(connection, BankSyncJobKind.SCHEDULED)
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

        runner.release[second].set()
        assert await second_runner == 1

    assert await _pending_items() == {(accounts[0].id, "HOLD-2")}
    assert await _job_states() == {job.id: ("succeeded", 2)}


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
    """A hosted runner's call returns within its limits and leaves the rest queued for its next call

    A job may run for 5 minutes, so one is claimed only while the deadline is at least that far off
    """
    for connection in connections[:3]:
        await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    deadline = None if time_left is None else frozen_now + time_left

    assert await run_jobs(max_jobs, deadline) == claimed

    assert sorted(status for status, _ in (await _job_states()).values()) == ["queued"] * (3 - claimed) + ["succeeded"] * claimed


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
async def test_run_jobs_records_a_job_that_fails_and_runs_the_next(connections, monkeypatch, failure, kind):
    """A job that raises or runs past its time limit is recorded as failed, and the next job still runs"""
    failing = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED)
    following = await _seed_job(connections[1], BankSyncJobKind.SCHEDULED)

    async def runner(job: ClaimedJob) -> None:
        """Fail the first connection's job, and run the other"""
        if job.id == failing.id:
            if failure == "raises":
                raise RuntimeError("Unexpected bank data")
            await asyncio.sleep(_WAIT_SECONDS)
        await run_sync_job(job)

    monkeypatch.setattr(worker, "run_sync_job", runner)
    monkeypatch.setattr(worker, "JOB_TIME_LIMIT", timedelta(seconds=1))

    async with asyncio.timeout(_WAIT_SECONDS):
        assert await run_jobs(10) == 2

    assert await _job_outcomes() == {failing.id: ("failed", kind), following.id: ("succeeded", None)}


async def test_enqueue_due_work_queues_each_due_connection_as_its_owner_and_stamps_the_heartbeat(connections, frozen_now):
    """Two owners' connections past their next sync get a scheduled job each, and one not yet due gets none"""
    async with TestSession() as session:
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
