import pytest

from app.services.auth import registration


@pytest.fixture
def closed_registration(monkeypatch):
    """Run the test as if REGISTRATION_ENABLED were set to false"""
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)
