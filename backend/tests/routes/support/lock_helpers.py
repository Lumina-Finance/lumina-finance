"""Shared helpers for tests that hold one request on a database lock while another queues"""

import asyncio

from sqlalchemy import text

from tests.conftest import TestSession


async def _wait_until_blocked(blocker_pid: int, blocked_pid: int) -> None:
    """Observe the actual PostgreSQL wait rather than assuming a scheduled task reached the lock."""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"), {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)
