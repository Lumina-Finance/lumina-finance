"""The fixture that resets the tables first cancels the tasks a test left running"""

import asyncio

from sqlalchemy import text

from tests.conftest import TestSession, _cancel_started_since


async def _hold_a_lock(holding: asyncio.Event) -> None:
    async with TestSession() as session:
        try:
            await session.execute(text("LOCK TABLE users IN ACCESS SHARE MODE"))
        finally:
            # Set even when the lock fails, so the test fails on that error and does not wait for it
            holding.set()
        await asyncio.sleep(3600)


async def test_a_request_left_running_is_cancelled_and_lets_go_of_its_lock():
    """A request holding a lock when its test ends would make the reset wait behind that lock"""
    running = asyncio.all_tasks()
    holding = asyncio.Event()
    request = asyncio.create_task(_hold_a_lock(holding))
    await holding.wait()
    assert not request.done()

    await _cancel_started_since(running)

    assert request.cancelled()
    async with TestSession() as session:
        # Fails after two seconds when the request still holds its lock, as the reset would wait behind it that long
        await session.execute(text("SET LOCAL lock_timeout = '2s'"))
        await session.execute(text("LOCK TABLE users IN ACCESS EXCLUSIVE MODE"))


async def test_a_task_running_before_the_test_is_left_alone():
    """A task running before the test started belongs to a fixture, so cancelling the test's tasks spares that task"""
    earlier = asyncio.create_task(asyncio.sleep(3600))
    running = asyncio.all_tasks()

    await _cancel_started_since(running)

    assert not earlier.done()
    earlier.cancel()
    await asyncio.gather(earlier, return_exceptions=True)
