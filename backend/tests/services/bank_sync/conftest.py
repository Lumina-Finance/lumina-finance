import asyncio
from collections.abc import Iterator
from datetime import datetime, timedelta

import pytest
from freezegun import freeze_time

from app.models.bank_connection import BankConnection
from app.models.currency import Currency
from app.services.bank_sync import schedule, sync, worker
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_connection, _build_user
from tests.services.bank_sync.stand_ins import FROZEN_NOW


@pytest.fixture(autouse=True)
def sent_action_emails(sent_action_emails) -> list:
    """Record every email a bank sync test sends, so none reaches whichever sender the test process installed"""
    return sent_action_emails


@pytest.fixture
def worker_sessions(monkeypatch) -> None:
    """Open the worker's and the job runner's sessions on this test run's database as the app role, as production opens them"""
    monkeypatch.setattr(worker, "async_session", ScopedSession)
    monkeypatch.setattr(sync, "async_session", ScopedSession)


@pytest.fixture
async def connections() -> list[BankConnection]:
    """Commit four connections, each with its own owner, so the worker's sessions can see them"""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.flush()
        users = [_build_user(f"owner{index}@example.com") for index in range(4)]
        session.add_all(users)
        await session.flush()
        built = [_build_bank_connection(user.id) for user in users]
        session.add_all(built)
        await session.commit()
    return built


@pytest.fixture
def day_later(monkeypatch) -> timedelta:
    """Draw every daily sync's random wait at its longest, so a link's next daily sync falls 24 and a half hours after its sync started

    Returns:
        How long after a sync starts the links it brought up to date next sync
    """
    monkeypatch.setattr(schedule, "randbelow", lambda limit: limit - 1)
    return timedelta(hours=24, minutes=30)


class JobTimeLimits:
    """The time limit of the job the worker started last. It runs until the next one starts"""

    def __init__(self) -> None:
        """Start with no job started"""
        self.running: asyncio.Timeout | None = None

    def end_running(self) -> None:
        """End the running job's time limit now, as though the job had run for all of it"""
        self.running.reschedule(asyncio.get_running_loop().time())


@pytest.fixture
def job_time_limits(monkeypatch) -> JobTimeLimits:
    """Hand the test each job's time limit, to end once the job reaches the state the test needs

    Each limit keeps its real length, so a slow host can't end a job before that state, and no test
    waits one out. The worker's limits are told apart from other timeouts by their length
    """
    limits = JobTimeLimits()
    start_timeout = asyncio.timeout

    def timeout(delay: float | None) -> asyncio.Timeout:
        started = start_timeout(delay)
        if delay == worker.JOB_TIME_LIMIT.total_seconds():
            limits.running = started
        return started

    monkeypatch.setattr(asyncio, "timeout", timeout)
    return limits


@pytest.fixture
def frozen_now() -> Iterator[datetime]:
    """Freeze the clock at FROZEN_NOW, leaving asyncio's own clock running so timeouts still fire"""
    with freeze_time(FROZEN_NOW, real_asyncio=True):
        yield FROZEN_NOW
