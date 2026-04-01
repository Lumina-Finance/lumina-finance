from app.models.currency import Currency
from tests.conftest import TestSession

# --- Helpers ---

SIGNUP_PAYLOAD = {
    "email": "test@example.com",
    "password": "securepassword123",
    "first_name": "Test",
    "tz": "America/Toronto",
    "base_currency": "CAD",
}


async def _seed_currency():
    """Insert the CAD currency row required by the user's base_currency FK."""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_user(client):
    """Seed currency and sign up a test user. Returns the signup response."""
    await _seed_currency()
    return await client.post("/auth/signup", json=SIGNUP_PAYLOAD)


def _auth_header(resp):
    """Extract a Bearer Authorization header dict from a signup/login response."""
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- GET /me ---


async def test_get_me_returns_full_profile(client):
    """Authenticated GET /me returns all user profile fields."""
    signup_resp = await _create_user(client)
    headers = _auth_header(signup_resp)

    resp = await client.get("/me", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == SIGNUP_PAYLOAD["email"]
    assert data["first_name"] == SIGNUP_PAYLOAD["first_name"]
    assert data["last_name"] is None
    assert data["profile_pic"] is None
    assert data["tz"] == SIGNUP_PAYLOAD["tz"]
    assert data["base_currency"] == SIGNUP_PAYLOAD["base_currency"]
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_get_me_without_auth_returns_401(client):
    """GET /me without an Authorization header returns 401."""
    resp = await client.get("/me")
    assert resp.status_code == 401


async def test_get_me_with_invalid_token_returns_401(client):
    """GET /me with a garbage Bearer token returns 401."""
    resp = await client.get("/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401
