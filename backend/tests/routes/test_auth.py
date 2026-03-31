from sqlalchemy import select

from app.models.active_token import ActiveToken
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
        from app.models.currency import Currency

        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


# --- Signup ---


async def test_signup_returns_user_and_access_token(client):
    """Successful signup returns user info and an access token."""
    await _seed_currency()
    resp = await client.post("/auth/signup", json=SIGNUP_PAYLOAD)

    assert resp.status_code == 201
    data = resp.json()
    user = data["user"]
    assert user["email"] == SIGNUP_PAYLOAD["email"]
    assert user["first_name"] == SIGNUP_PAYLOAD["first_name"]
    assert user["last_name"] == SIGNUP_PAYLOAD.get("last_name")
    assert user["id"] is not None
    assert user["created_at"] is not None
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_signup_sets_refresh_cookie(client):
    """Successful signup sets an httpOnly refresh token cookie."""
    await _seed_currency()
    resp = await client.post("/auth/signup", json=SIGNUP_PAYLOAD)

    assert resp.status_code == 201
    assert "refresh_token" in resp.cookies


async def test_signup_registers_tokens_in_active_tokens(client):
    """Signup stores both access and refresh token jti in active_tokens."""
    await _seed_currency()
    await client.post("/auth/signup", json=SIGNUP_PAYLOAD)

    async with TestSession() as session:
        result = await session.execute(select(ActiveToken))
        tokens = result.scalars().all()
        assert len(tokens) == 2


async def test_signup_duplicate_email_returns_409(client):
    """Signing up with an existing email returns 409 Conflict."""
    await _seed_currency()
    await client.post("/auth/signup", json=SIGNUP_PAYLOAD)
    resp = await client.post("/auth/signup", json=SIGNUP_PAYLOAD)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Email already registered"
