from datetime import UTC, datetime, timedelta
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import app
from app.models.active_token import ActiveToken
from app.models.user import User
from tests.conftest import TestSession
from tests.routes.conftest import SIGNUP_PAYLOAD, _create_user, _seed_currency

# --- Helpers ---

LOGIN_PAYLOAD = {
    "email": "test@example.com",
    "password": "securepassword123",
}


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


async def test_signup_without_last_name_succeeds(client):
    """Signup with last_name omitted should succeed since it's optional."""
    await _seed_currency()
    payload = {k: v for k, v in SIGNUP_PAYLOAD.items() if k != "last_name"}
    resp = await client.post("/auth/signup", json=payload)

    assert resp.status_code == 201
    assert resp.json()["user"]["last_name"] is None


async def test_signup_missing_required_field_returns_422(client):
    """Signup without a required field returns 422 validation error."""
    await _seed_currency()
    payload = {k: v for k, v in SIGNUP_PAYLOAD.items() if k != "email"}
    resp = await client.post("/auth/signup", json=payload)

    assert resp.status_code == 422


async def test_signup_invalid_base_currency_returns_422(client):
    """Signup with a non-existent currency code returns 422."""
    await _seed_currency()
    payload = {**SIGNUP_PAYLOAD, "base_currency": "XXX"}
    resp = await client.post("/auth/signup", json=payload)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid currency code"


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


async def test_successful_login_resets_failed_attempt_count(client):
    """A successful login after failed attempts resets the counter to zero."""
    await _create_user(client)
    bad_login = {"email": "test@example.com", "password": "wrongpassword"}

    # 3 failed attempts (below lockout threshold of 5)
    for _ in range(3):
        await client.post("/auth/login", json=bad_login)

    # Successful login should reset the counter
    resp = await client.post("/auth/login", json=LOGIN_PAYLOAD)
    assert resp.status_code == 200

    # Verify counter was reset in the database
    async with TestSession() as session:
        from app.models.auth import PasswordCredential

        result = await session.execute(select(PasswordCredential))
        credential = result.scalar_one()
        assert credential.failed_attempt_count == 0
        assert credential.locked_until is None


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


async def test_access_token_as_refresh_cookie_returns_401(client):
    """An access token cannot be used as a refresh token (different signing key)."""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]

    client.cookies.set("refresh_token", access_token)
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired refresh token"


async def test_refresh_revokes_old_access_token(client):
    """After refresh, the old access token is also removed from active_tokens."""
    signup_resp = await _create_user(client)
    old_access_token = signup_resp.json()["access_token"]
    refresh_cookie = signup_resp.cookies["refresh_token"]

    # Record JTIs from the signup pair
    async with TestSession() as session:
        result = await session.execute(select(ActiveToken.jti))
        old_jtis = {row[0] for row in result.all()}
        assert len(old_jtis) == 2

    client.cookies.set("refresh_token", refresh_cookie)
    refresh_resp = await client.post("/auth/refresh")
    assert refresh_resp.status_code == 200

    new_access_token = refresh_resp.json()["access_token"]

    # Old pair replaced by new pair — JTIs should be entirely different
    async with TestSession() as session:
        result = await session.execute(select(ActiveToken.jti))
        new_jtis = {row[0] for row in result.all()}
        assert len(new_jtis) == 2
        assert old_jtis.isdisjoint(new_jtis)

    # The old access token should no longer authenticate
    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {old_access_token}"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Token is not active"

    # The new access token should work
    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {new_access_token}"})
    assert resp.status_code == 200


async def test_expired_tokens_purged_on_token_issuance(client):
    """Expired active_token rows are cleaned up when new tokens are issued."""
    await _create_user(client)

    # Seed an expired token directly in the DB
    expired_jti = uuid4()
    async with TestSession() as session:
        user_result = await session.execute(select(User))
        user = user_result.scalars().first()

        session.add(ActiveToken(
            jti=expired_jti,
            user_id=user.id,
            session_id=uuid4(),
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        ))
        await session.commit()

    # 2 valid signup tokens + 1 expired = 3 total
    async with TestSession() as session:
        result = await session.execute(select(ActiveToken))
        assert len(result.scalars().all()) == 3

    # Login triggers _issue_and_store_tokens which purges expired rows
    login_resp = await client.post(
        "/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]},
    )
    assert login_resp.status_code == 200

    async with TestSession() as session:
        # The expired token should be gone
        result = await session.execute(select(ActiveToken).where(ActiveToken.jti == expired_jti))
        assert result.scalar_one_or_none() is None

        # Valid tokens survive: 2 from signup + 2 from login = 4
        result = await session.execute(select(ActiveToken))
        assert len(result.scalars().all()) == 4


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


async def test_double_logout_is_idempotent(client):
    """Calling logout twice with the same tokens should return 200 both times."""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]
    refresh_cookie = signup_resp.cookies["refresh_token"]
    headers = {"Authorization": f"Bearer {access_token}"}

    client.cookies.set("refresh_token", refresh_cookie)
    resp1 = await client.post("/auth/logout", headers=headers)
    assert resp1.status_code == 200

    client.cookies.set("refresh_token", refresh_cookie)
    resp2 = await client.post("/auth/logout", headers=headers)
    assert resp2.status_code == 200


async def test_logout_without_refresh_cookie_still_revokes_session(client):
    """Logout revokes the whole session (both rows) even if the refresh cookie is missing.

    Session-scoped revocation reads the sid claim from the access token, so the cookie
    is irrelevant for killing the session. This exercises the cookie-absent edge case.
    """
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]

    # httpx auto-stores the Set-Cookie from signup; drop it to exercise the cookie-absent path
    client.cookies.delete("refresh_token")
    resp = await client.post("/auth/logout", headers={"Authorization": f"Bearer {access_token}"})

    assert resp.status_code == 200
    assert resp.json()["detail"] == "Logged out"

    # Both rows for the session should be gone even though the cookie was never sent
    async with TestSession() as session:
        result = await session.execute(select(ActiveToken))
        tokens = result.scalars().all()
        assert len(tokens) == 0


async def test_logout_only_affects_caller_session(client):
    """Logging out on one device must not touch other active sessions for the same user."""
    # Session 1 via signup
    signup_resp = await _create_user(client)
    session1_access = signup_resp.json()["access_token"]

    # Session 2 via a separate client (fresh cookie jar) logging in as the same user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as second_client:
        login_resp = await second_client.post("/auth/login", json=LOGIN_PAYLOAD)
        assert login_resp.status_code == 200
        session2_access = login_resp.json()["access_token"]

        # Two sessions x two rows each = 4 active_tokens rows
        async with TestSession() as db:
            result = await db.execute(select(ActiveToken))
            assert len(result.scalars().all()) == 4

        # Logout session 1
        resp = await client.post("/auth/logout", headers={"Authorization": f"Bearer {session1_access}"})
        assert resp.status_code == 200

        # Session 2's rows survive
        async with TestSession() as db:
            result = await db.execute(select(ActiveToken))
            assert len(result.scalars().all()) == 2

        # Session 2's access token still authenticates
        me_resp = await second_client.get("/test/me", headers={"Authorization": f"Bearer {session2_access}"})
        assert me_resp.status_code == 200

        # Session 1's access token is dead
        dead_resp = await client.get("/test/me", headers={"Authorization": f"Bearer {session1_access}"})
        assert dead_resp.status_code == 401


# --- JWKS ---


async def test_jwks_returns_both_keys_with_correct_kids(client):
    """JWKS endpoint returns both access and refresh public keys with configured kid values."""
    from app.config import JWT_ACCESS_KID, JWT_REFRESH_KID

    resp = await client.get("/auth/.well-known/jwks.json")

    assert resp.status_code == 200
    keys = resp.json()["keys"]
    assert len(keys) == 2

    kids = {k["kid"] for k in keys}
    assert JWT_ACCESS_KID in kids
    assert JWT_REFRESH_KID in kids


async def test_jwks_keys_have_valid_structure(client):
    """Each JWK has the required RSA fields and metadata."""
    resp = await client.get("/auth/.well-known/jwks.json")
    required_fields = {"kty", "n", "e", "use", "kid", "alg"}

    for key in resp.json()["keys"]:
        assert required_fields.issubset(key.keys())
        assert key["kty"] == "RSA"
        assert key["use"] == "sig"
        assert key["alg"] == "RS256"


# --- get_current_user ---


async def test_valid_access_token_authenticates(client):
    """A valid access token returns the authenticated user via the dependency."""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {access_token}"})

    assert resp.status_code == 200
    assert resp.json()["email"] == SIGNUP_PAYLOAD["email"]


async def test_invalid_access_token_returns_401(client):
    """A garbage access token is rejected."""
    resp = await client.get("/test/me", headers={"Authorization": "Bearer not.a.valid.jwt"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired token"


async def test_revoked_access_token_returns_401(client):
    """An access token removed from the allowlist is rejected."""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]
    refresh_cookie = signup_resp.cookies["refresh_token"]

    # Logout revokes the token
    client.cookies.set("refresh_token", refresh_cookie)
    await client.post("/auth/logout", headers={"Authorization": f"Bearer {access_token}"})

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {access_token}"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Token is not active"


async def test_refresh_token_as_access_token_returns_401(client):
    """A refresh token cannot be used as an access token (different signing key)."""
    signup_resp = await _create_user(client)
    refresh_cookie = signup_resp.cookies["refresh_token"]

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {refresh_cookie}"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired token"
