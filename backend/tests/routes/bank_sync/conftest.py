import pytest

from tests.services.bank_sync.fake_provider import FakeProviderAdapter


@pytest.fixture(autouse=True)
def bank_provider(fake_provider) -> FakeProviderAdapter:
    """Offer the fake provider to every bank sync route test, as a server with bank sync offers its providers"""
    return fake_provider
