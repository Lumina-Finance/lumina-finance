from collections.abc import AsyncIterator, Iterator
from datetime import datetime

import httpx
import pytest
from freezegun import freeze_time

from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.stand_ins import FROZEN_NOW, SIMPLEFIN_BRIDGE_ORIGIN, FakeBridgeScenario


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
