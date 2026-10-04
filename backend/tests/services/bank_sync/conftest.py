from collections.abc import AsyncIterator, Iterator
from datetime import datetime

import httpx
import pytest
from freezegun import freeze_time

from app.models.bank_connection import BankConnection
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.routes.support.bank_sync_helpers import _build_bank_connection, _build_user
from tests.services.bank_sync.stand_ins import FROZEN_NOW, SIMPLEFIN_BRIDGE_ORIGIN, FakeBridgeScenario


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
async def scenario() -> AsyncIterator[FakeBridgeScenario]:
    """An empty scenario on the in-process fake SimpleFIN Bridge, reached at SimpleFIN Bridge's own origin"""
    async with httpx.AsyncClient(transport=FakeBridgeTransport(), base_url=SIMPLEFIN_BRIDGE_ORIGIN) as control:
        yield await FakeBridgeScenario.create(control)


@pytest.fixture
def frozen_now() -> Iterator[datetime]:
    """Freeze the clock at FROZEN_NOW, leaving asyncio's own clock running so timeouts still fire"""
    with freeze_time(FROZEN_NOW, real_asyncio=True):
        yield FROZEN_NOW
