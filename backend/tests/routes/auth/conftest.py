import pytest

from app import dependencies
from app.routes.auth import token_helpers
from app.services.auth import discovery, registration, reset_send_limit, send_backoff, signup, tokens


@pytest.fixture(autouse=True)
def reset_clock(monkeypatch):
    """Start each test with no email back-offs or queued sends and a clock it moves with advance"""
    reset_send_limit.reset_backoff._entries.clear()
    signup._signup_backoff._entries.clear()
    signup._sends_under_way.clear()
    reset_send_limit._admitted.clear()
    monkeypatch.setattr(reset_send_limit, "_slots", None)
    now = [1000.0]
    monkeypatch.setattr(reset_send_limit, "monotonic", lambda: now[0])
    monkeypatch.setattr(send_backoff, "monotonic", lambda: now[0])

    def advance(seconds):
        """Move the clock forward"""
        now[0] += seconds

    return advance


@pytest.fixture
def closed_registration(monkeypatch):
    """Run the test as if REGISTRATION_ENABLED were set to false"""
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)


@pytest.fixture
def issuer_set_to(monkeypatch):
    """Return a function that runs the test with another token issuer

    Each module imported the issuer by value, so every one that signs or checks a token is replaced,
    and a module left out would make tokens signed under one issuer fail the check of another
    """

    def set_issuer(issuer: str) -> None:
        """Make every module that signs or checks tokens use the issuer"""
        for module in (dependencies, discovery, token_helpers, tokens):
            monkeypatch.setattr(module, "JWT_ISSUER", issuer)

    return set_issuer
