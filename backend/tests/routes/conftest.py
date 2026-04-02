from typing import Annotated

import pytest
from fastapi import Depends
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.dependencies import get_current_user
from app.main import app
from app.models.currency import Currency
from app.models.user import User
from tests.conftest import TestSession


async def _override_get_db():
    """Override the app's DB dependency to use the test database.

    Yields:
        An async SQLAlchemy session bound to the test database.
    """
    async with TestSession() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db


# Test-only route to exercise the get_current_user dependency
@app.get("/test/me")
async def _test_me(user: Annotated[User, Depends(get_current_user)]):
    return {"id": str(user.id), "email": user.email}


# --- Shared test helpers ---

SIGNUP_PAYLOAD = {
    "email": "test@example.com",
    "password": "securepassword123",
    "first_name": "Test",
    "tz": "America/Toronto",
    "base_currency": "CAD",
}


async def _seed_currency():
    """Insert the CAD currency row required by the user's base_currency FK.

    Inserts via raw session (not the API) because currencies are seeded data,
    not user-created resources.
    """
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_user(client):
    """Seed currency and sign up a test user.

    Args:
        client: The async test client.

    Returns:
        The HTTP response from the signup endpoint.
    """
    await _seed_currency()
    return await client.post("/auth/signup", json=SIGNUP_PAYLOAD)


def _get_auth_header(resp):
    """Extract a Bearer Authorization header dict from a signup/login response.

    Args:
        resp: The HTTP response containing an access_token.

    Returns:
        A dict with the Authorization header set to the Bearer token.
    """
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def client():
    """Provide an async HTTP client wired to the FastAPI app with the test database.

    Yields:
        An httpx AsyncClient bound to the FastAPI app via ASGITransport.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
