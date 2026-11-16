import pytest

from tests.services.bank_sync.authorizing_provider import AuthorizingProviderAdapter
from tests.services.bank_sync.fake_provider import FakeProviderAdapter, use_adapter


@pytest.fixture(autouse=True)
def bank_provider(fake_provider) -> FakeProviderAdapter:
    """Offer the fake provider to every bank sync route test, as a server with bank sync offers its providers"""
    return fake_provider


@pytest.fixture
def authorizing_provider(monkeypatch) -> AuthorizingProviderAdapter:
    """Install the scripted provider that connects by signing in at the bank, enabled and offered, beside the fake one"""
    adapter = AuthorizingProviderAdapter()
    use_adapter(monkeypatch, adapter)
    return adapter
