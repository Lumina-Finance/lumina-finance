"""Reading the bank sync worker's heartbeat

Every due scan stamps the heartbeat. The provider list and the worker's health check both read it
here, so the app learns whether sync is running without importing the worker's own code
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_sync_job import BankSyncHeartbeat

# Sync counts as not running once the heartbeat every due scan stamps is older than this, the
# time three scans take
SYNC_STOPPED_AFTER = timedelta(minutes=15)


async def is_sync_worker_running(db: AsyncSession, now: datetime) -> bool:
    """Return whether a worker has scanned for due work recently enough to count as running

    A deployment whose worker never started has no heartbeat and reads as not running

    Args:
        db: Any session, since the heartbeat describes the deployment rather than a user
        now: The current time
    """
    last_scan_at = await db.scalar(select(BankSyncHeartbeat.last_scan_at))
    return last_scan_at is not None and now - last_scan_at <= SYNC_STOPPED_AFTER
