from collections.abc import AsyncIterator

import httpx
import pytest

from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.stand_ins import SIMPLEFIN_BRIDGE_ORIGIN, FakeBridgeScenario


@pytest.fixture
async def scenario() -> AsyncIterator[FakeBridgeScenario]:
    """An empty scenario on the in-process fake SimpleFIN Bridge, reached at SimpleFIN Bridge's own origin"""
    async with httpx.AsyncClient(transport=FakeBridgeTransport(), base_url=SIMPLEFIN_BRIDGE_ORIGIN) as control:
        yield await FakeBridgeScenario.create(control)
