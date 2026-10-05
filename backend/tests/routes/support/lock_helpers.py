"""Waiting for a request to queue behind a row lock"""

import asyncio

from sqlalchemy import text

from tests.conftest import TestSession


async def _wait_until_waiting_on(blocker_pid: int, request: asyncio.Task):
    """Wait until a backend waits on a lock the blocker holds, or the request has already answered"""
    async with asyncio.timeout(5), TestSession() as observer:
        while not request.done():
            is_waiting = await observer.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND :pid = ANY(pg_blocking_pids(pid)))"),
                {"pid": blocker_pid},
            )
            if is_waiting:
                return
            await asyncio.sleep(0.01)


async def _wait_until_blocked(blocker_pid: int, blocked_pid: int) -> None:
    """Observe the actual PostgreSQL wait rather than assuming a scheduled task reached the lock."""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"), {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)
