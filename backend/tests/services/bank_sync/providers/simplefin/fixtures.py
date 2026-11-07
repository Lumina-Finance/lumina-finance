"""Fixtures for SimpleFIN's tests, loaded only while the SimpleFIN provider is installed"""

from collections.abc import AsyncIterator

import httpx
import pytest

from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.simplefin.stand_ins import SIMPLEFIN_BRIDGE_ORIGIN, FakeBridgeScenario, simplefin_adapter


@pytest.fixture(autouse=True)
def simplefin_reaches_the_fake_bridge(monkeypatch) -> SimpleFinAdapter:
    """Serve SimpleFIN, enabled and offered, through an adapter whose requests reach only the in-process fake SimpleFIN Bridge"""
    adapter = simplefin_adapter(FakeBridgeTransport())
    use_adapter(monkeypatch, adapter)
    return adapter


@pytest.fixture
async def scenario() -> AsyncIterator[FakeBridgeScenario]:
    """An empty scenario on the in-process fake SimpleFIN Bridge, reached at SimpleFIN Bridge's own origin"""
    async with httpx.AsyncClient(transport=FakeBridgeTransport(), base_url=SIMPLEFIN_BRIDGE_ORIGIN) as control:
        yield await FakeBridgeScenario.create(control)
