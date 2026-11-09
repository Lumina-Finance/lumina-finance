"""Bank sync jobs: queueing, claiming across users, the fence around finishing, the due scan and the heartbeat

The claim and the due scan run as the worker, the app role with no request identity, through the
definer functions, and queueing runs as the connection's owner under row-level security, so these
tests call each the same way. A job claimed twice would sync a connection twice at once, and a
queued job started beside a running one would race it, and a merge that drops the links a job
queued itself to plan last hands their failing requests back the next request that frees. A
connection whose claim stopped mid-listing that the scan never finds due stays empty, and one it
finds due while a listing is under way is listed twice
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text, update

from app.models.bank_connection import BankConnection
from app.models.bank_sync_job import BankSyncHeartbeat, BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.services.bank_sync.jobs import ClaimedJob, JobNotHeld, claim_bank_sync_job, enqueue_bank_sync_job, finish_job, lock_held_job
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_connection, _job_states, _seed_job
from tests.routes.support.identity_helpers import _act_as

_CLAIM = text("SELECT job_id, owner_id, connection_id, kind, discover, attempt FROM public.claim_bank_sync_jobs(:limit)")


async def _claim(limit: int) -> list:
    """Claim jobs as the worker in a transaction of its own"""
    async with ScopedSession() as session:
        claimed = (await session.execute(_CLAIM, {"limit": limit})).all()
        await session.commit()
    return claimed


# The job a listing that failed leaves behind, finished as failed
_LISTING_FAILED = {"status": BankSyncJobStatus.FAILED, "attempt": 1, "last_error_kind": "unknown"}


async def _list_due(now: datetime) -> list[tuple]:
    """Return the connections the due scan finds due at this time, as the worker reads them"""
    async with ScopedSession() as worker:
        due = await worker.execute(text("SELECT connection_id, owner_id FROM public.list_due_bank_connections(:now)"), {"now": now})
        return [tuple(row) for row in due]


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

    # The first worker holds its claim open while the second claims, as overlapping workers would.
    # Were the claim to wait on the first worker's lock instead of skipping it, the lock timeout
    # fails the test rather than leaving it hanging
    async with ScopedSession() as first_worker, ScopedSession() as second_worker:
        first = (await first_worker.execute(_CLAIM, {"limit": 1})).all()
        await second_worker.execute(text("SET LOCAL lock_timeout = '2s'"))
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


async def _claim_job() -> ClaimedJob:
    """Claim the next due job as the worker, the way a runner does"""
    async with ScopedSession() as session:
        job = await claim_bank_sync_job(session)
        await session.commit()
    return job


async def _holds(job: ClaimedJob) -> bool:
    """Return whether the job's finishing step may go ahead, opened as its owner and rolled back"""
    async with _act_as(job.owner_id) as session:
        try:
            await lock_held_job(session, job)
        except JobNotHeld:
            return False
    return True


async def test_lock_held_job_refuses_an_attempt_a_later_claim_took_over(connections):
    """Attempt 1 may write nothing once its lease has run out, while attempt 2 and the owner's other job's attempt 1 still may"""
    second_connection = _build_bank_connection(connections[0].owner_id)
    async with TestSession() as session:
        session.add(second_connection)
        await session.commit()
    taken_over = await _seed_job(connections[0], BankSyncJobKind.MANUAL)
    await _seed_job(second_connection, BankSyncJobKind.SCHEDULED)
    first, other = await _claim_job(), await _claim_job()
    async with TestSession() as session:
        await session.execute(
            update(BankSyncJob).where(BankSyncJob.id == taken_over.id).values(lease_expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()
    second = await _claim_job()

    assert [(job.id, job.attempt) for job in (first, second)] == [(taken_over.id, 1), (taken_over.id, 2)]
    assert other.attempt == 1
    assert [await _holds(job) for job in (first, second, other)] == [False, True, True]


async def test_lock_held_job_refuses_a_job_already_finished(connections):
    """A runner that already recorded its job as finished can't record it a second time, as failed or otherwise"""
    await _seed_job(connections[0], BankSyncJobKind.SCHEDULED)
    job = await _claim_job()
    async with _act_as(job.owner_id) as session:
        await lock_held_job(session, job)
        await finish_job(session, job)
        await session.commit()

    assert not await _holds(job)
    assert (await _job_states())[job.id] == ("succeeded", 1)


async def test_claim_returns_only_what_the_worker_needs_and_leaves_jobs_not_yet_due(connections):
    """A job due later stays queued, and a claimed one carries ids, kind, discovery and attempt"""
    later = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, run_after=datetime.now(UTC) + timedelta(hours=1))
    due = await _seed_job(connections[1], BankSyncJobKind.INITIAL, discover=True)

    claimed = await _claim(10)

    assert [tuple(row) for row in claimed] == [
        (due.id, connections[1].owner_id, connections[1].id, "initial", True, 1),
    ]
    assert (await _job_states())[later.id] == ("queued", 0)


async def _enqueue_as_owner(connection: BankConnection, *requests: dict) -> tuple[list, datetime | None]:
    """Queue each request for a connection as its owner, under row-level security

    Returns:
        The kind, discovery flag and status of every job the owner then sees, and the queued
        job's run-after time
    """
    async with _act_as(connection.owner_id) as session:
        for request in requests:
            await enqueue_bank_sync_job(session, owner_id=connection.owner_id, connection_id=connection.id, **request)
        jobs = (await session.execute(select(BankSyncJob.kind, BankSyncJob.discover, BankSyncJob.status).order_by(BankSyncJob.status))).all()
        run_after = await session.scalar(select(BankSyncJob.run_after).where(BankSyncJob.status == BankSyncJobStatus.QUEUED))
        await session.commit()
    return [tuple(job) for job in jobs], run_after


async def test_enqueue_onto_a_queued_scheduled_job_makes_it_manual(connections):
    """Pressing Sync now while a scheduled job waits leaves one queued job, now manual"""
    jobs, _ = await _enqueue_as_owner(
        connections[0],
        {"kind": BankSyncJobKind.SCHEDULED},
        {"kind": BankSyncJobKind.MANUAL},
        {"kind": BankSyncJobKind.SCHEDULED},
    )

    assert jobs == [("manual", False, "queued")]


@pytest.mark.parametrize(
    ("requests", "kind"),
    [
        (({"kind": BankSyncJobKind.SCHEDULED, "discover": True}, {"kind": BankSyncJobKind.RETRY}), "retry"),
        (({"kind": BankSyncJobKind.SCHEDULED}, {"kind": BankSyncJobKind.MANUAL, "discover": True}), "manual"),
    ],
    ids=["queued_rediscovery_then_retry", "scheduled_then_sync_now_with_rediscovery"],
)
async def test_enqueue_keeps_a_rediscovery_whichever_request_asked(connections, requests, kind):
    """A rediscovery survives a merge whether the queued job or the new request asked for it"""
    jobs, _ = await _enqueue_as_owner(connections[0], *requests)

    assert jobs == [(kind, True, "queued")]


async def test_enqueue_keeps_a_job_queued_for_later_waiting_by_the_databases_clock_though_the_apps_runs_behind(connections, frozen_now):
    """The app's clock reads 4 October here, behind the database's, and a retry it queues for 30 minutes on still waits 30 minutes

    Kept as the app's time, the job would be claimed at once, before the app counts its retry due,
    and would fetch every other link again and queue itself for the same time, claimed at once again
    """
    _, run_after = await _enqueue_as_owner(connections[0], {"kind": BankSyncJobKind.RETRY, "run_after": frozen_now + timedelta(minutes=30)})

    assert await _claim(1) == []
    async with TestSession() as session:
        database_now = await session.scalar(select(func.now()))
    assert timedelta(minutes=29) < run_after - database_now <= timedelta(minutes=30)


@pytest.mark.parametrize("scheduled_first", [True, False], ids=["sync_now_onto_tomorrows_job", "tomorrows_job_onto_sync_now"])
async def test_enqueue_runs_a_merged_job_at_the_earlier_time(connections, scheduled_first):
    """Sync now and tomorrow's scheduled sync, merged in either order, run now as a manual job"""
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    requests = [{"kind": BankSyncJobKind.SCHEDULED, "run_after": tomorrow}, {"kind": BankSyncJobKind.MANUAL}]

    jobs, run_after = await _enqueue_as_owner(connections[0], *(requests if scheduled_first else reversed(requests)))

    assert jobs == [("manual", False, "queued")]
    assert run_after < tomorrow - timedelta(hours=23)


@pytest.mark.parametrize(
    ("first", "second", "minutes"),
    [
        ((BankSyncJobKind.INITIAL, 2), (BankSyncJobKind.INITIAL, 3), 3),
        ((BankSyncJobKind.INITIAL, 3), (BankSyncJobKind.INITIAL, 2), 3),
        ((BankSyncJobKind.SCHEDULED, 600), (BankSyncJobKind.INITIAL, 2), 2),
        ((BankSyncJobKind.RETRY, 1), (BankSyncJobKind.INITIAL, 2), 1),
    ],
    ids=["a_later_link_moves_the_import_on", "an_earlier_time_leaves_it", "a_daily_sync_is_pulled_forward", "a_retry_is_not_pushed_back"],
)
async def test_enqueue_moves_a_queued_import_to_the_later_time_only_for_an_import_waiting_for_more_links(connections, first, second, minutes):
    """Each account linked in a row moves the connection's queued import to 2 minutes after it, so they share one import

    Only an import waits like that. A scheduled sync or a retry already queued runs at the earlier time
    """
    now = datetime.now(UTC)
    requests = [
        {"kind": kind, "run_after": now + timedelta(minutes=wait), "moves_queued_import_later": True} for kind, wait in (first, second)
    ]

    _, run_after = await _enqueue_as_owner(connections[0], *requests)

    async with TestSession() as session:
        database_now = await session.scalar(select(func.now()))
    assert timedelta(minutes=minutes - 1) < run_after - database_now <= timedelta(minutes=minutes)


@pytest.mark.parametrize(
    "kinds",
    [(BankSyncJobKind.INITIAL, BankSyncJobKind.MANUAL), (BankSyncJobKind.MANUAL, BankSyncJobKind.INITIAL)],
    ids=["initial_then_manual", "manual_then_initial"],
)
async def test_enqueue_initial_import_outranks_sync_now_in_either_order(connections, kinds):
    """Sync now pressed during a first import's wait leaves the job an initial one"""
    jobs, _ = await _enqueue_as_owner(connections[0], *({"kind": kind} for kind in kinds))

    assert jobs == [("initial", False, "queued")]


async def test_enqueue_plans_last_the_links_either_request_plans_last(connections):
    """A job queued to plan Card and Savings last, merged with one planning Travel and Card last, plans each of the three last once"""
    card, savings, travel = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    await _enqueue_as_owner(
        connections[0],
        {"kind": BankSyncJobKind.RETRY, "deferred_link_ids": [card, savings]},
        {"kind": BankSyncJobKind.SCHEDULED, "deferred_link_ids": [travel, card]},
    )

    async with TestSession() as session:
        deferred = await session.scalar(select(BankSyncJob.deferred_link_ids).where(BankSyncJob.status == BankSyncJobStatus.QUEUED))
    assert sorted(deferred) == sorted([card, savings, travel])


async def test_enqueue_while_a_job_runs_queues_one_job_behind_it(connections):
    """A connection holds one running and one queued job, however much work arrives"""
    connection = connections[0]
    lease = datetime.now(UTC) + timedelta(minutes=5)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, status=BankSyncJobStatus.RUNNING, attempt=1, lease_expires_at=lease)

    jobs, _ = await _enqueue_as_owner(connection, {"kind": BankSyncJobKind.MANUAL}, {"kind": BankSyncJobKind.RETRY})

    assert jobs == [("manual", False, "queued"), ("scheduled", False, "running")]


async def test_list_due_bank_connections_returns_due_ones_across_owners_by_id(connections):
    """Due connections, each listed a day ago, come back as ids and owners, leaving those not due and those rejected"""
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
            stored.discovered_at = now - timedelta(days=1)
        await session.commit()

    assert await _list_due(now) == [
        (connections[1].id, connections[1].owner_id),
        (connections[0].id, connections[0].owner_id),
    ]


@pytest.mark.parametrize(
    ("values", "job", "due"),
    [
        ({"created_at": timedelta(hours=1)}, None, True),
        ({"created_at": timedelta(minutes=59)}, None, False),
        ({"discovery_failed_at": timedelta(hours=1)}, _LISTING_FAILED | {"finished_at": datetime(2026, 10, 4, 11, 0, tzinfo=UTC)}, True),
        ({"discovery_failed_at": timedelta(minutes=59)}, _LISTING_FAILED | {"finished_at": datetime(2026, 10, 4, 11, 1, tzinfo=UTC)}, False),
        ({"discovered_at": timedelta(days=2)}, None, False),
        ({"credential_rejected_at": timedelta(hours=1)}, None, False),
        ({}, {"status": BankSyncJobStatus.QUEUED}, False),
        ({}, {"status": BankSyncJobStatus.RUNNING, "attempt": 1, "lease_expires_at": datetime(2026, 10, 4, 12, 5, tzinfo=UTC)}, False),
        ({}, {"status": BankSyncJobStatus.SUCCEEDED, "attempt": 1, "finished_at": datetime(2026, 10, 4, 11, 55, tzinfo=UTC)}, True),
    ],
    ids=[
        "claimed_an_hour_ago",
        "claimed_59_minutes_ago",
        "listing_failed_an_hour_ago",
        "listing_failed_59_minutes_ago",
        "listed_before",
        "credential_rejected",
        "job_queued",
        "job_running",
        "job_finished",
    ],
)
async def test_list_due_bank_connections_returns_one_never_listed_once_nothing_is_under_way_for_an_hour(connections, values, job, due):
    """A connection claimed a day ago whose bank accounts were never listed, and with no next sync, is due a listing

    Not within an hour of its claim or of a listing that failed, while a job is queued or running for
    it, once it was listed, or with its credential rejected. The other owners' connections, claimed
    and listed a day ago, aren't due, and a sync queued for one of them holds back none but its own
    """
    now = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
    async with TestSession() as session:
        for other in connections[1:]:
            stored = await session.get(BankConnection, other.id)
            stored.created_at = stored.discovered_at = now - timedelta(days=1)
        stored = await session.get(BankConnection, connections[0].id)
        stored.created_at = now - timedelta(days=1)
        for field, ago in values.items():
            setattr(stored, field, now - ago)
        await session.commit()
    await _seed_job(connections[1], BankSyncJobKind.SCHEDULED)
    if job is not None:
        await _seed_job(connections[0], BankSyncJobKind.RETRY, discover=True, **job)

    assert await _list_due(now) == ([(connections[0].id, connections[0].owner_id)] if due else [])


async def test_record_bank_sync_scan_stamps_the_heartbeat_and_leaves_finished_jobs_to_the_cleanup(connections):
    """A scan, made every few minutes, keeps the job finished long ago, and the heartbeat says when it ran"""
    first_of_september = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    finished = {"status": BankSyncJobStatus.SUCCEEDED, "attempt": 1}
    old = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, finished_at=first_of_september, **finished)
    queued = await _seed_job(connections[2], BankSyncJobKind.SCHEDULED)
    scans = (datetime(2026, 10, 1, 13, 0, tzinfo=UTC), datetime(2026, 10, 2, 12, 0, tzinfo=UTC))

    for scanned_at in scans:
        async with ScopedSession() as worker:
            await worker.execute(text("SELECT public.record_bank_sync_scan(:now)"), {"now": scanned_at})
            await worker.commit()

    assert set(await _job_states()) == {old.id, queued.id}
    async with TestSession() as session:
        assert (await session.execute(select(BankSyncHeartbeat.id, BankSyncHeartbeat.last_scan_at))).all() == [(1, scans[1])]
        assert await session.scalar(select(func.count()).select_from(BankSyncHeartbeat)) == 1
