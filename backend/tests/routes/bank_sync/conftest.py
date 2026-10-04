import pytest

from app.models.bank_connection import BankProvider
from app.services.bank_sync import availability
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.stand_ins import simplefin_adapter


@pytest.fixture(autouse=True)
def _simplefin_reaches_the_fake_bridge(monkeypatch):
    """Serve SimpleFIN through an adapter whose requests reach only the in-process fake SimpleFIN Bridge"""
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, simplefin_adapter(FakeBridgeTransport()))
