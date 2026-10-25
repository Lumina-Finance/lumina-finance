import pytest

from app.services.auth import registration, reset_send_limit


@pytest.fixture(autouse=True)
def reset_clock(monkeypatch):
    """Start each test with no password reset back-offs or queued sends and a clock it moves with advance"""
    reset_send_limit._backoffs.clear()
    reset_send_limit._admitted.clear()
    monkeypatch.setattr(reset_send_limit, "_slots", None)
    now = [1000.0]
    monkeypatch.setattr(reset_send_limit, "monotonic", lambda: now[0])

    def advance(seconds):
        """Move the clock forward"""
        now[0] += seconds

    return advance


@pytest.fixture
def closed_registration(monkeypatch):
    """Run the test as if REGISTRATION_ENABLED were set to false"""
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)
