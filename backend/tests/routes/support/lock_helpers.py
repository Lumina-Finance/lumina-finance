"""Waiting for a request to queue behind a row lock"""

import asyncio
import contextvars
from collections.abc import Sequence

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
    """Wait until this many backends queue behind a lock the blocker holds, failing if the request answers first

    A request that answers without queueing never met the lock, so the test would pass without the
    race it is there for. Several requests gathered into one future count as one request that answers
    when all of them have
    """
    async with asyncio.timeout(5), TestSession() as observer:
        while True:
            if request.done():
                raise AssertionError(f"The request answered without queueing behind the lock: {request.result()!r}")
            if await observer.scalar(_QUEUED_BEHIND, {"pid": blocker_pid}) >= waiters:
                return
            await asyncio.sleep(0.01)


async def _cancel_unfinished(requests: Sequence[asyncio.Task]) -> None:
    """Cancel the requests still running and wait for them to stop

    A test that fails while its requests queue behind a lock, such as one a deadlock picks as its
    victim, would otherwise leave them running into the next test
    """
    for request in requests:
        request.cancel()
    await asyncio.gather(*requests, return_exceptions=True)


async def _wait_until_blocked(blocker_pid: int, blocked_pid: int) -> None:
    """Observe the actual PostgreSQL wait rather than assuming a scheduled task reached the lock."""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"),
                {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)


# Set inside one request's task, so a patched session method acts on that request alone
_held_request = contextvars.ContextVar("held_request", default=False)


async def _pid(db) -> int:
    return await db.scalar(text("SELECT pg_backend_pid()"))


async def _overlap(first, second, *, first_held, release, second_entered, pids):
    """Run the first request to its hold, queue the second behind it, then let both finish."""
    requests = []
    try:
        async with asyncio.timeout(10):
            requests.append(asyncio.create_task(first()))
            await first_held.wait()
            requests.append(asyncio.create_task(second()))
            await second_entered.wait()
            await _wait_until_blocked(pids[0], pids[1])
            release.set()
            return await asyncio.gather(*requests)
    finally:
        release.set()
        for request in requests:
            if not request.done():
                request.cancel()
        await asyncio.gather(*requests, return_exceptions=True)


def _record_pid(monkeypatch, module, name: str, pids: list[int], entered: asyncio.Event):
    """Record the queued request's database backend as it enters a step, so its lock wait can be observed."""
    original = getattr(module, name)

    async def record(db, *args, **kwargs):
        if _held_request.get():
            return await original(db, *args, **kwargs)
        pids.append(await _pid(db))
        entered.set()
        return await original(db, *args, **kwargs)

    monkeypatch.setattr(module, name, record)
