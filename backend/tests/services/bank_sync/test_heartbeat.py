"""Reading the bank sync worker's heartbeat

The provider list and the worker's health check both read it, so a wrong boundary either hides a
stopped worker or tells users sync has stopped while it runs
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.bank_sync_job import BankSyncHeartbeat
from app.services.bank_sync.heartbeat import is_sync_worker_running
from tests.conftest import ScopedSession, TestSession


@pytest.mark.parametrize(
    ("scanned_ago", "running"),
    [(None, False), (timedelta(minutes=15), True), (timedelta(minutes=15, seconds=1), False)],
    ids=["never_scanned", "scanned_15_minutes_ago", "scanned_just_over_15_minutes_ago"],
)
async def test_is_sync_worker_running_until_its_heartbeat_is_over_15_minutes_old(scanned_ago, running):
    """The app says sync isn't running once no due scan has stamped the heartbeat for over 15 minutes"""
    now = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
    if scanned_ago is not None:
        async with TestSession() as session:
            session.add(BankSyncHeartbeat(last_scan_at=now - scanned_ago))
            await session.commit()

    async with ScopedSession() as session:
        assert await is_sync_worker_running(session, now) is running
