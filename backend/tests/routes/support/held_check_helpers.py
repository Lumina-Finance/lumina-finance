"""Holding an authentication check until a whole burst of requests has made its claim"""

import asyncio
import inspect
import threading
from collections.abc import Callable, Coroutine
from typing import Any

# Long enough for a loaded test host to start every request, short enough to fail a stuck test loudly
_HOLD_TIMEOUT_SECONDS = 20


class HeldCheck:
    """Stands in for a password or second-factor check, counting its calls and parking them until released

    A check that is not meant to be held, chosen by `holds`, runs at once. Both a blocking check, which
    runs in a worker thread, and a coroutine function are supported
    """

    def __init__(self, original: Callable, holds: Callable[..., bool] = lambda *args: True) -> None:
        """Wrap the check, holding only the calls `holds` accepts"""
        self._original = original
        self._holds = holds
        self.calls = 0
        self._count_lock = threading.Lock()
        self._released = threading.Event()
        self._async_released = asyncio.Event()

    def _count(self) -> None:
        """Record one call"""
        with self._count_lock:
            self.calls += 1

    def release(self) -> None:
        """Let every parked call carry on"""
        self._released.set()
        self._async_released.set()

    def __call__(self, *args: Any) -> Any:
        """Run the original check, parking it first when it is a held one"""
        if inspect.iscoroutinefunction(self._original):
            return self._run_async(*args)
        self._count()
        if self._holds(*args):
            assert self._released.wait(timeout=_HOLD_TIMEOUT_SECONDS), "Held check was not released"
        return self._original(*args)

    async def _run_async(self, *args: Any) -> Any:
        """Run an original coroutine function, parking it first when it is a held one"""
        self._count()
        if self._holds(*args):
            async with asyncio.timeout(_HOLD_TIMEOUT_SECONDS):
                await self._async_released.wait()
        return await self._original(*args)


async def start_burst(requests: list[Coroutine], held: HeldCheck) -> list[asyncio.Task]:
    """Send every request at once and wait until each is parked in the check or answered

    Waiting for that settled state, rather than a pause, is what makes the count of checks exact: a
    request is counted either inside the check or as answered without one

    Args:
        requests: The requests to send in parallel
        held: The check that parks its callers

    Returns:
        The running requests, still parked
    """
    tasks = [asyncio.create_task(request) for request in requests]
    try:
        async with asyncio.timeout(_HOLD_TIMEOUT_SECONDS):
            while held.calls + sum(task.done() for task in tasks) < len(tasks):
                await asyncio.sleep(0.05)
    except BaseException:
        held.release()
        raise
    return tasks


async def finish_burst(tasks: list[asyncio.Task], held: HeldCheck) -> list:
    """Release the parked checks and return every response, in the order the requests were sent"""
    held.release()
    return await asyncio.gather(*tasks)


async def fire_burst(requests: list[Coroutine], held: HeldCheck) -> list:
    """Send a burst, let it settle, release it and return the responses"""
    return await finish_burst(await start_burst(requests, held), held)
