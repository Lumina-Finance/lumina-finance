"""Bank sync jobs: queueing, claiming across users, the due scan and the heartbeat

The claim and the due scan run as the worker, the app role with no request identity, through the
definer functions, so these tests call them the same way. A job claimed twice would sync a
connection twice at once, and a queued job started beside a running one would race it
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text

from app.models.bank_connection import BankConnection
from app.models.bank_sync_job import BankSyncHeartbeat, BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.models.currency import Currency
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_connection, _build_user

_CLAIM = text("SELECT job_id, owner_id, connection_id, kind, discover, attempt FROM public.claim_bank_sync_jobs(:limit)")


@pytest.fixture
async def connections():
    """Commit four connections, each with its own owner, so the worker's sessions can see them"""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.flush()
        users = [_build_user(f"owner{index}@example.com") for index in range(4)]
        session.add_all(users)
        await session.flush()
        built = [_build_bank_connection(user.id) for user in users]
        session.add_all(built)
        await session.commit()
    return built


async def _seed_job(connection: BankConnection, kind: BankSyncJobKind, **values) -> BankSyncJob:
    """Commit a job for a connection, queued and due an hour ago unless told otherwise"""
    values.setdefault("run_after", datetime.now(UTC) - timedelta(hours=1))
    job = BankSyncJob(owner_id=connection.owner_id, connection_id=connection.id, kind=kind, **values)
    async with TestSession() as session:
        session.add(job)
        await session.commit()
    return job


async def _claim(limit: int) -> list:
    """Claim jobs as the worker in a transaction of its own"""
    async with ScopedSession() as session:
        claimed = (await session.execute(_CLAIM, {"limit": limit})).all()
        await session.commit()
    return claimed


async def _job_states() -> dict:
    """Return every job's status and attempt by id, read as the table owner"""
    async with TestSession() as session:
        rows = (await session.execute(select(BankSyncJob.id, BankSyncJob.status, BankSyncJob.attempt))).all()
    return {job_id: (status, attempt) for job_id, status, attempt in rows}


async def test_claim_takes_initial_and_manual_jobs_before_retries_and_scheduled_ones(connections):
    """A scheduled job due longest is still claimed last"""
    scheduled = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, run_after=datetime.now(UTC) - timedelta(days=1))
    retry = await _seed_job(connections[1], BankSyncJobKind.RETRY)
    manual = await _seed_job(connections[2], BankSyncJobKind.MANUAL)
    initial = await _seed_job(connections[3], BankSyncJobKind.INITIAL)

    claimed = [(await _claim(1))[0].job_id for _ in range(4)]

    assert claimed == [initial.id, manual.id, retry.id, scheduled.id]


async def test_claim_by_two_workers_at_once_gives_each_a_different_job(connections):
    """Two workers claiming together across two owners never share a job"""
    first_job = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED)
    second_job = await _seed_job(connections[1], BankSyncJobKind.SCHEDULED)

    # The first worker holds its claim open while the second claims, as overlapping workers would
    async with ScopedSession() as first_worker, ScopedSession() as second_worker:
        first = (await first_worker.execute(_CLAIM, {"limit": 1})).all()
        second = (await second_worker.execute(_CLAIM, {"limit": 1})).all()
        await first_worker.commit()
        await second_worker.commit()

    assert {first[0].job_id, second[0].job_id} == {first_job.id, second_job.id}
    assert {first[0].owner_id, second[0].owner_id} == {connections[0].owner_id, connections[1].owner_id}
    assert await _claim(10) == []


async def test_claim_waits_while_the_connection_has_a_job_running(connections):
    """Connection A's queued job waits for its running one, while other connections' jobs go"""
    lease = datetime.now(UTC) + timedelta(minutes=5)
    await _seed_job(connections[0], BankSyncJobKind.MANUAL, status=BankSyncJobStatus.RUNNING, attempt=1, lease_expires_at=lease)
    waiting = await _seed_job(connections[0], BankSyncJobKind.MANUAL)
    other = await _seed_job(connections[1], BankSyncJobKind.SCHEDULED)

    claimed = await _claim(10)

    assert [row.job_id for row in claimed] == [other.id]
    assert (await _job_states())[waiting.id] == ("queued", 0)


async def test_claim_takes_back_an_expired_job_before_the_connections_queued_one(connections):
    """A worker that crashed in attempt 1 loses the job to attempt 2 once its lease runs out"""
    expired = datetime.now(UTC) - timedelta(minutes=8)
    crashed = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, status=BankSyncJobStatus.RUNNING, attempt=1, lease_expires_at=expired)
    waiting = await _seed_job(connections[0], BankSyncJobKind.MANUAL)
    before = datetime.now(UTC)

    claimed = await _claim(10)

    assert [(row.job_id, row.attempt) for row in claimed] == [(crashed.id, 2)]
    assert (await _job_states())[waiting.id] == ("queued", 0)
    async with TestSession() as session:
        lease_expires_at = await session.scalar(select(BankSyncJob.lease_expires_at).where(BankSyncJob.id == crashed.id))
    assert before + timedelta(minutes=9) < lease_expires_at < datetime.now(UTC) + timedelta(minutes=11)


async def test_claim_returns_only_what_the_worker_needs_and_leaves_jobs_not_yet_due(connections):
    """A job due later stays queued, and a claimed one carries ids, kind, discovery and attempt"""
    later = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, run_after=datetime.now(UTC) + timedelta(hours=1))
    due = await _seed_job(connections[1], BankSyncJobKind.INITIAL, discover=True)

    claimed = await _claim(10)

    assert [tuple(row) for row in claimed] == [
        (due.id, connections[1].owner_id, connections[1].id, "initial", True, 1),
    ]
    assert (await _job_states())[later.id] == ("queued", 0)


async def _queued_jobs(session) -> list:
    """Return the kind, discovery flag and status of every job, read in the given session"""
    return (await session.execute(select(BankSyncJob.kind, BankSyncJob.discover, BankSyncJob.status).order_by(BankSyncJob.status))).all()


async def test_enqueue_onto_a_queued_scheduled_job_makes_it_manual(db, connections):
    """Pressing Sync now while a scheduled job waits leaves one queued job, now manual"""
    connection = connections[0]
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.SCHEDULED)
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.MANUAL)
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.SCHEDULED)

    assert [tuple(row) for row in await _queued_jobs(db)] == [("manual", False, "queued")]


async def test_enqueue_of_a_plain_retry_keeps_the_queued_rediscovery(db, connections):
    """A retry arriving before a queued rediscovery runs doesn't drop the rediscovery"""
    connection = connections[0]
    await enqueue_bank_sync_job(
        db,
        owner_id=connection.owner_id,
        connection_id=connection.id,
        kind=BankSyncJobKind.SCHEDULED,
        discover=True,
    )
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.RETRY)

    assert [tuple(row) for row in await _queued_jobs(db)] == [("retry", True, "queued")]


async def test_enqueue_runs_a_merged_job_at_the_earlier_time(db, connections):
    """Sync now merged into tomorrow's scheduled job makes it due now"""
    connection = connections[0]
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    await enqueue_bank_sync_job(
        db,
        owner_id=connection.owner_id,
        connection_id=connection.id,
        kind=BankSyncJobKind.SCHEDULED,
        run_after=tomorrow,
    )
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.MANUAL)

    assert await db.scalar(select(BankSyncJob.run_after)) < tomorrow


async def test_enqueue_while_a_job_runs_queues_one_job_behind_it(db, connections):
    """A connection holds one running and one queued job, however much work arrives"""
    connection = connections[0]
    lease = datetime.now(UTC) + timedelta(minutes=5)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, status=BankSyncJobStatus.RUNNING, attempt=1, lease_expires_at=lease)

    for kind in (BankSyncJobKind.MANUAL, BankSyncJobKind.RETRY):
        await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=kind)

    assert [tuple(row) for row in await _queued_jobs(db)] == [("manual", False, "queued"), ("scheduled", False, "running")]


async def test_list_due_bank_connections_returns_due_ones_across_owners_by_id(connections):
    """Due connections come back as ids and owners, leaving those not due and those rejected"""
    now = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
    async with TestSession() as session:
        for connection, next_sync_at, rejected_at in (
            (connections[0], now - timedelta(minutes=5), None),
            (connections[1], now - timedelta(hours=2), None),
            (connections[2], now + timedelta(minutes=5), None),
            (connections[3], now - timedelta(hours=1), now - timedelta(days=1)),
        ):
            stored = await session.get(BankConnection, connection.id)
            stored.next_sync_at = next_sync_at
            stored.credential_rejected_at = rejected_at
        await session.commit()

    async with ScopedSession() as worker:
        due = (
            await worker.execute(
                text("SELECT connection_id, owner_id FROM public.list_due_bank_connections(:now)"),
                {"now": now},
            )
        ).all()

    assert [tuple(row) for row in due] == [
        (connections[1].id, connections[1].owner_id),
        (connections[0].id, connections[0].owner_id),
    ]


async def test_record_bank_sync_scan_stamps_the_heartbeat_and_deletes_old_finished_jobs(connections):
    """A job finished on 1 September is gone by 2 October, and the heartbeat says when the scan ran"""
    first_of_september = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    finished = {"status": BankSyncJobStatus.SUCCEEDED, "attempt": 1}
    await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, finished_at=first_of_september, **finished)
    kept = await _seed_job(connections[1], BankSyncJobKind.SCHEDULED, finished_at=first_of_september + timedelta(days=5), **finished)
    queued = await _seed_job(connections[2], BankSyncJobKind.SCHEDULED)
    scans = (datetime(2026, 10, 1, 13, 0, tzinfo=UTC), datetime(2026, 10, 2, 12, 0, tzinfo=UTC))

    for scanned_at in scans:
        async with ScopedSession() as worker:
            await worker.execute(text("SELECT public.record_bank_sync_scan(:now)"), {"now": scanned_at})
            await worker.commit()

    assert set(await _job_states()) == {kept.id, queued.id}
    async with TestSession() as session:
        assert (await session.execute(select(BankSyncHeartbeat.id, BankSyncHeartbeat.last_scan_at))).all() == [(1, scans[1])]
        assert await session.scalar(select(func.count()).select_from(BankSyncHeartbeat)) == 1
