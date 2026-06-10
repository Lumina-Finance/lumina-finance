"""Shared auth route test helpers"""

from app.models.currency import Currency
from tests.conftest import TestSession

SIGNUP_PAYLOAD = {
    "email": "test@example.com",
    "password": "securepassword123",
    "first_name": "Test",
    "tz": "America/Toronto",
    "base_currency": "CAD",
}


async def _seed_currency():
    """Insert the CAD currency row required by user signup

    Returns:
        None
    """
    async with TestSession() as session:

        # Insert the default signup currency so auth route tests can create users
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_user(client):
    """Create the default signed-up user with the route API

    Args:
        client: Async test client

    Returns:
        API response from signing up the user
    """
    await _seed_currency()
    return await client.post("/auth/signup", json=SIGNUP_PAYLOAD)


def _get_auth_header(resp):
    """Return a Bearer Authorization header from an auth response

    Args:
        resp: API response containing an access token

    Returns:
        Authorization header for authenticated route calls
    """
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
