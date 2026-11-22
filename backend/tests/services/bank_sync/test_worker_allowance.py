"""What the allowance check stops in the bank sync worker: a scan queues nothing for a refused owner, and a job already queued ends

A refusal never counts as a failed sync, so no link shows a failed attempt and nobody is emailed. A
check that raises is a fault in the deployment's own code: the scan logs it for that connection and
queues every other owner's, as for any other connection that fails to queue
"""

import logging
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.allowance_hook import AllowanceKind, AllowanceRequest, Refusal, set_allowance_check
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.services.bank_sync import worker
from app.services.bank_sync.worker import enqueue_due_work, run_jobs
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_account, _build_bank_link, _seed_job

pytestmark = pytest.mark.usefixtures("worker_sessions")


def _refuse_owner_of(connection: BankConnection, *, raising: bool = False) -> None:
    """Install a check that refuses bank sync to one connection's owner, or fails for them, and allows everyone else"""

    async def check(request: AllowanceRequest) -> Refusal | None:
        if request.user_id != connection.owner_id or request.kind != AllowanceKind.BANK_SYNC:
            return None
        if raising:
            raise ConnectionError("The plan service is down")
        return Refusal("Bank sync is not part of your plan")

    set_allowance_check(check)


async def _make_due(connections: list[BankConnection], now: datetime) -> None:
    """List the connections a day ago and make them due their scheduled sync five minutes ago"""
    async with TestSession() as session:
        await session.execute(
            update(BankConnection)
            .where(BankConnection.id.in_([connection.id for connection in connections]))
            .values(discovered_at=now - timedelta(days=1), next_sync_at=now - timedelta(minutes=5))
        )
        await session.commit()


async def _connections_with_jobs() -> set:
    """Return the connections that have a job"""
    async with TestSession() as session:
        return set(await session.scalars(select(BankSyncJob.connection_id)))


async def test_enqueue_due_work_queues_nothing_for_a_refused_owner_and_still_queues_the_others(connections, frozen_now):
    """Two owners are due a scheduled sync, the first is refused bank sync, and only the second owner's connection is queued"""
    await _make_due(connections[:2], frozen_now)
    _refuse_owner_of(connections[0])

    await enqueue_due_work()

    assert await _connections_with_jobs() == {connections[1].id}


async def test_enqueue_due_work_logs_a_check_that_raises_and_queues_the_other_owners(connections, frozen_now, caplog):
    """A check failing for the first owner is logged against that connection, and the second owner's sync is still queued"""
    await _make_due(connections[:2], frozen_now)
    _refuse_owner_of(connections[0], raising=True)

    with caplog.at_level(logging.ERROR, logger=worker.logger.name):
        await enqueue_due_work()

    assert await _connections_with_jobs() == {connections[1].id}
    assert [record.args for record in caplog.records if record.name == worker.logger.name] == [(connections[0].id,)]


async def test_run_jobs_ends_a_queued_job_of_a_refused_owner_without_failing_it_and_runs_the_others(
    connections, frozen_now, sent_action_emails
):
    """A job queued before the refusal ends as finished with no error, its link records no failed attempt and nobody is emailed

    The other owner's job still runs
    """
    account = _build_account(connections[0].owner_id, name="Everyday")
    async with TestSession() as session:
        session.add(account)
        await session.flush()
        link = _build_bank_link(account, connections[0], "ACT-everyday")
        session.add(link)
        await session.commit()
    refused = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED, covered_link_ids=[link.id])
    allowed = await _seed_job(connections[1], BankSyncJobKind.SCHEDULED)
    _refuse_owner_of(connections[0])

    assert await run_jobs(10) == 2

    async with TestSession() as session:
        outcomes = {
            job.id: (job.status, job.last_error_kind)
            for job in await session.scalars(select(BankSyncJob).where(BankSyncJob.id.in_([refused.id, allowed.id])))
        }
        stored_link = await session.get(BankAccountLink, link.id)
        retries_of_refused = await session.scalars(
            select(BankSyncJob.id).where(BankSyncJob.connection_id == connections[0].id, BankSyncJob.status == BankSyncJobStatus.QUEUED)
        )
    assert outcomes == {refused.id: ("succeeded", None), allowed.id: ("succeeded", None)}, (
        "a refused job counted as failed or was left unfinished"
    )
    assert (stored_link.retry_count, stored_link.last_failure_reason) == (0, None), "the refusal was recorded as a failed attempt"
    assert sent_action_emails == [], "a refused sync emailed its owner"
    assert list(retries_of_refused) == [], "a refused job queued a retry"
