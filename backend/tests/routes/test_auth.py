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


LOGIN_PAYLOAD = {
    "email": "test@example.com",
    "password": "securepassword123",
}


async def _seed_currency():
    """Insert the CAD currency row required by the user's base_currency FK."""
    async with TestSession() as session:
        from app.models.currency import Currency

        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_user(client):
    """Seed currency and sign up a test user. Returns the signup response."""
    await _seed_currency()
    return await client.post("/auth/signup", json=SIGNUP_PAYLOAD)


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


# --- Login ---


async def test_login_returns_user_and_access_token(client):
    """Valid credentials return user info and an access token."""
    await _create_user(client)
    resp = await client.post("/auth/login", json=LOGIN_PAYLOAD)

    assert resp.status_code == 200
    data = resp.json()
    user = data["user"]
    assert user["email"] == SIGNUP_PAYLOAD["email"]
    assert user["first_name"] == SIGNUP_PAYLOAD["first_name"]
    assert user["last_name"] == SIGNUP_PAYLOAD.get("last_name")
    assert user["id"] is not None
    assert user["created_at"] is not None
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "refresh_token" in resp.cookies


async def test_login_invalid_email_returns_401(client):
    """Non-existent email returns 401."""
    await _create_user(client)
    resp = await client.post("/auth/login", json={"email": "nobody@example.com", "password": LOGIN_PAYLOAD["password"]})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


async def test_login_invalid_password_returns_401(client):
    """Wrong password returns 401."""
    await _create_user(client)
    resp = await client.post("/auth/login", json={"email": "test@example.com", "password": "wrongpassword"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


async def test_login_locks_account_after_5_failed_attempts(client):
    """Account is locked for 30 minutes after 5 consecutive failed login attempts."""
    await _create_user(client)
    bad_login = {"email": "test@example.com", "password": "wrongpassword"}

    for _ in range(5):
        resp = await client.post("/auth/login", json=bad_login)
        assert resp.status_code == 401

    # 6th attempt should return 423 Locked
    resp = await client.post("/auth/login", json=bad_login)
    assert resp.status_code == 423
    assert resp.json()["detail"] == "Account temporarily locked"


async def test_login_locked_account_rejects_valid_credentials(client):
    """Even correct credentials are rejected when the account is locked."""
    await _create_user(client)
    bad_login = {"email": "test@example.com", "password": "wrongpassword"}

    for _ in range(5):
        await client.post("/auth/login", json=bad_login)

    # Valid password should still be rejected
    resp = await client.post("/auth/login", json=LOGIN_PAYLOAD)
    assert resp.status_code == 423


# --- Refresh ---


async def test_refresh_returns_new_token_pair(client):
    """Valid refresh cookie returns a new access token and refresh cookie."""
    signup_resp = await _create_user(client)
    refresh_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", refresh_cookie)
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == SIGNUP_PAYLOAD["email"]
    assert "refresh_token" in resp.cookies


async def test_refresh_rotates_token(client):
    """After refresh, the old refresh token is deleted and a new one is issued."""
    signup_resp = await _create_user(client)
    old_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", old_cookie)
    resp = await client.post("/auth/refresh")
    new_cookie = resp.cookies["refresh_token"]

    # Old and new cookies should differ
    assert old_cookie != new_cookie

    # Old token should no longer work
    client.cookies.set("refresh_token", old_cookie)
    resp = await client.post("/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_missing_cookie_returns_401(client):
    """Request with no refresh cookie returns 401."""
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Missing refresh token"


async def test_refresh_invalid_cookie_returns_401(client):
    """Tampered or garbage refresh cookie returns 401."""
    client.cookies.set("refresh_token", "not.a.valid.jwt")
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired refresh token"


# --- Logout ---


async def test_logout_revokes_tokens_and_clears_cookie(client):
    """Logout removes both tokens from active_tokens and clears the refresh cookie."""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]
    refresh_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", refresh_cookie)
    resp = await client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert resp.status_code == 200
    assert resp.json()["detail"] == "Logged out"

    # Both tokens should be removed from the allowlist
    async with TestSession() as session:
        result = await session.execute(select(ActiveToken))
        tokens = result.scalars().all()
        assert len(tokens) == 0


async def test_logout_access_token_cannot_be_reused(client):
    """After logout, the revoked access token should not authenticate."""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]
    refresh_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", refresh_cookie)
    await client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    # Refresh with the old cookie should fail
    client.cookies.set("refresh_token", refresh_cookie)
    resp = await client.post("/auth/refresh")
    assert resp.status_code == 401


async def test_logout_without_auth_header_returns_401(client):
    """Logout without an Authorization header is rejected by the bearer dependency."""
    resp = await client.post("/auth/logout")

    assert resp.status_code == 401
