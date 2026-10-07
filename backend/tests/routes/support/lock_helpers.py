"""Waiting for a request to queue behind a row lock"""

import asyncio

from sqlalchemy import text

from tests.conftest import TestSession

# The backends waiting behind the blocker, directly or behind another backend waiting there. The
# second request for a locked row waits on the first one's claim to it rather than on the blocker.
# Only backends waiting for a lock are asked what blocks them, since asking holds every lock
# partition and asking for every backend would hold back the requests being waited for
_QUEUED_BEHIND = text(
    """
    WITH RECURSIVE waiting AS (
        SELECT DISTINCT pid FROM pg_locks WHERE NOT granted
    ),
    queued(pid) AS (
        SELECT pid FROM waiting WHERE :pid = ANY(pg_blocking_pids(pid))
        UNION
        SELECT waiting.pid FROM waiting JOIN queued ON queued.pid = ANY(pg_blocking_pids(waiting.pid))
    )
    SELECT count(*) FROM queued
    """
)


async def _wait_until_waiting_on(blocker_pid: int, request: asyncio.Future, waiters: int = 1):
    """Wait until this many backends queue behind a lock the blocker holds, or the request has already answered

    Several requests gathered into one future count as one request that answers when all of them have
    """
    async with asyncio.timeout(5), TestSession() as observer:
        while not request.done():
            if await observer.scalar(_QUEUED_BEHIND, {"pid": blocker_pid}) >= waiters:
                return
            await asyncio.sleep(0.01)


async def _wait_until_blocked(blocker_pid: int, blocked_pid: int) -> None:
    """Observe the actual PostgreSQL wait rather than assuming a scheduled task reached the lock."""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"),
                {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)
