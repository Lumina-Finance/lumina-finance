from typing import Annotated

import pytest
from fastapi import Depends
from httpx import ASGITransport, AsyncClient

from app.database import current_user_id_ctx, get_db, get_session_factory
from app.dependencies import get_current_user
from app.main import app
from app.models.user import User
from app.services.email import contract as email_contract
from tests.conftest import ScopedSession
from tests.routes.support.mailbox import mailbox


async def _override_get_db():
    """Override the app's DB dependency to use the row-level-security test session

    Connects as the app role so route tests run under the policies exactly as
    production does, confirming legitimate access is never blocked

    Yields:
        An async SQLAlchemy session bound to the test database as the app role
    """
    # Clear any inherited identity so a request can only ever stamp its own user,
    # matching the production dependency
    current_user_id_ctx.set(None)
    async with ScopedSession() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db

# Work a route runs after its response opens its sessions from this factory instead of get_db
app.dependency_overrides[get_session_factory] = lambda: ScopedSession


# Test-only route to exercise the get_current_user dependency
@app.get("/test/me")
async def _test_me(user: Annotated[User, Depends(get_current_user)]):
    """Return the current user payload for auth dependency tests

    Args:
        user: Current authenticated user resolved by the dependency

    Returns:
        Minimal user identity payload
    """
    return {"id": str(user.id), "email": user.email}


@pytest.fixture(autouse=True)
def captured_email(monkeypatch):
    """Install the capturing sender for the test, so sign-ups can read their emailed links

    Returns:
        The sender, empty at the start of each test
    """
    mailbox.sent.clear()
    monkeypatch.setattr(email_contract, "_active_sender", mailbox)
    return mailbox


@pytest.fixture
async def client():
    """Provide an async HTTP client wired to the FastAPI app with the test database

    Yields:
        An httpx AsyncClient bound to the FastAPI app via ASGITransport
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
