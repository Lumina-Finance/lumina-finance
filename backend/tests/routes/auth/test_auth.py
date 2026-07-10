import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import JWT_ACCESS_PRIVATE_KEY, JWT_ALGORITHM, JWT_ISSUER, JWT_REFRESH_PRIVATE_KEY
from app.main import app
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.user import User
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _seed_currency

# --- Helpers ---

LOGIN_PAYLOAD = {
    "email": "test@example.com",
    "password": "SecurePassword123!",
}


def _encode_auth_test_token(
    *,
    private_key: str,
    user_id,
    token_id,
    session_id,
    token_use: str,
    aud: str | None = None,
) -> str:
    """Return a signed JWT with explicit auth claims for edge-case tests

    The audience defaults to the token use, mirroring how the app mints tokens, so a crafted token
    clears the audience check and reaches the claim under test unless aud is overridden
    """
    issued_at = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "jti": str(token_id),
        "sid": str(session_id),
        "token_use": token_use,
        "aud": aud if aud is not None else token_use,
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=15),
        "iss": JWT_ISSUER,
    }
    token = jwt.encode(payload, private_key, algorithm=JWT_ALGORITHM)
    return token


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


async def test_signup_rejects_weak_password(client):
    """Signup rejects a password that fails the strength policy."""
    await _seed_currency()
    resp = await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "password": "weak"})

    assert resp.status_code == 422


async def test_signup_sets_refresh_cookie(client):
    """Successful signup sets an httpOnly refresh token cookie."""
    await _seed_currency()
    resp = await client.post("/auth/signup", json=SIGNUP_PAYLOAD)

    assert resp.status_code == 201
    assert "refresh_token" in resp.cookies


async def test_signup_registers_auth_session_and_tokens(client):
    """Signup stores one auth session with access and refresh token rows"""
    await _seed_currency()
    await client.post("/auth/signup", json=SIGNUP_PAYLOAD)

    async with TestSession() as session:
        session_result = await session.execute(select(AuthSession))
        auth_sessions = session_result.scalars().all()
        assert len(auth_sessions) == 1

        token_result = await session.execute(select(AuthToken))
        tokens = token_result.scalars().all()
        assert {token.token_kind for token in tokens} == {AuthTokenKind.ACCESS, AuthTokenKind.REFRESH}
        assert {token.session_id for token in tokens} == {auth_sessions[0].id}


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


async def test_signup_invalid_timezone_returns_422(client):
    """Signup rejects non-IANA timezone names."""
    await _seed_currency()
    payload = {**SIGNUP_PAYLOAD, "tz": "Toronto"}
    resp = await client.post("/auth/signup", json=payload)

    assert resp.status_code == 422


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


async def test_lockout_signs_out_all_existing_sessions(client):
    """Tripping the lockout revokes every session and token the user already holds"""
    await _create_user(client)
    bad_login = {"email": "test@example.com", "password": "wrongpassword"}

    # Signup leaves one active session, which the fifth failure should tear down
    async with TestSession() as session:
        existing_sessions = (await session.execute(select(AuthSession))).scalars().all()
        assert len(existing_sessions) == 1

    for _ in range(5):
        await client.post("/auth/login", json=bad_login)

    async with TestSession() as session:
        remaining_sessions = (await session.execute(select(AuthSession))).scalars().all()
        remaining_tokens = (await session.execute(select(AuthToken))).scalars().all()
        assert remaining_sessions == []
        assert remaining_tokens == []


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


async def test_failed_attempt_after_expired_lock_starts_fresh(client):
    """Once the lockout window passes, a new failure restarts the count instead of re-locking immediately"""
    from app.models.auth import PasswordCredential

    await _create_user(client)
    bad_login = {"email": "test@example.com", "password": "wrongpassword"}

    for _ in range(5):
        await client.post("/auth/login", json=bad_login)

    # Move the lock into the past, as if the 30-minute window had elapsed
    async with TestSession() as session:
        credential = (await session.execute(select(PasswordCredential))).scalar_one()
        credential.locked_until = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    # A single failure after the window must not re-lock, and the count restarts at one
    resp = await client.post("/auth/login", json=bad_login)
    assert resp.status_code == 401

    async with TestSession() as session:
        credential = (await session.execute(select(PasswordCredential))).scalar_one()
        assert credential.failed_attempt_count == 1
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
    """After refresh, the old refresh token remains briefly usable in grace"""
    signup_resp = await _create_user(client)
    old_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", old_cookie)
    resp = await client.post("/auth/refresh")
    new_cookie = resp.cookies["refresh_token"]

    assert old_cookie != new_cookie

    client.cookies.set("refresh_token", old_cookie)
    resp = await client.post("/auth/refresh")
    assert resp.status_code == 200

    async with TestSession() as session:
        token_result = await session.execute(select(AuthToken))
        tokens = token_result.scalars().all()
        refresh_tokens = [token for token in tokens if token.token_kind == AuthTokenKind.REFRESH]
        access_tokens = [token for token in tokens if token.token_kind == AuthTokenKind.ACCESS]
        assert len(refresh_tokens) == 2
        assert len(access_tokens) == 1


async def test_previous_refresh_token_after_grace_returns_401(client):
    """A previous refresh token stops working after its grace window expires"""
    signup_resp = await _create_user(client)
    old_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", old_cookie)
    resp = await client.post("/auth/refresh")
    assert resp.status_code == 200

    async with TestSession() as session:
        result = await session.execute(
            select(AuthToken).where(
                AuthToken.token_kind == AuthTokenKind.REFRESH,
                AuthToken.refresh_grace_expires_at.is_not(None),
            ),
        )
        previous_refresh_token = result.scalar_one()
        previous_refresh_token.refresh_grace_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    client.cookies.set("refresh_token", old_cookie)
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Refresh token is not active"


async def test_rotated_away_refresh_token_returns_409_without_clearing_cookie(client):
    """A pruned stale refresh token does not clear a newer browser cookie"""
    signup_resp = await _create_user(client)
    old_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", old_cookie)
    first_resp = await client.post("/auth/refresh")
    assert first_resp.status_code == 200

    client.cookies.set("refresh_token", old_cookie)
    second_resp = await client.post("/auth/refresh")
    assert second_resp.status_code == 200

    client.cookies.set("refresh_token", old_cookie)
    third_resp = await client.post("/auth/refresh")

    assert third_resp.status_code == 409
    assert third_resp.json()["detail"] == "Refresh token was already rotated"
    assert "refresh_token" not in third_resp.cookies


async def test_concurrent_refresh_keeps_only_current_and_previous_refresh_tokens(client):
    """Concurrent refresh attempts keep one current and one previous refresh token"""
    signup_resp = await _create_user(client)
    refresh_cookie = signup_resp.cookies["refresh_token"]

    async def post_refresh_with_cookie():
        """Post one refresh request using an isolated client cookie jar"""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as refresh_client:
            refresh_client.cookies.set("refresh_token", refresh_cookie)
            response = await refresh_client.post("/auth/refresh")
            return response

    first_response, second_response = await asyncio.gather(
        post_refresh_with_cookie(),
        post_refresh_with_cookie(),
    )
    statuses = sorted([first_response.status_code, second_response.status_code])

    assert statuses == [200, 200]

    async with TestSession() as session:
        token_result = await session.execute(select(AuthToken))
        session_result = await session.execute(select(AuthSession))
        tokens = token_result.scalars().all()
        refresh_tokens = [token for token in tokens if token.token_kind == AuthTokenKind.REFRESH]
        access_tokens = [token for token in tokens if token.token_kind == AuthTokenKind.ACCESS]
        assert len(refresh_tokens) == 2
        assert len(access_tokens) == 1
        assert len(session_result.scalars().all()) == 1


async def test_concurrent_current_and_previous_refresh_tokens_do_not_deadlock(client):
    """Concurrent current and previous refresh tokens serialize on the auth session"""
    signup_resp = await _create_user(client)
    previous_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", previous_cookie)
    refresh_resp = await client.post("/auth/refresh")
    assert refresh_resp.status_code == 200
    current_cookie = refresh_resp.cookies["refresh_token"]

    async def post_refresh_with_cookie(refresh_cookie: str):
        """Post one refresh request using an isolated client cookie jar"""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as refresh_client:
            refresh_client.cookies.set("refresh_token", refresh_cookie)
            response = await refresh_client.post("/auth/refresh")
            return response

    previous_response, current_response = await asyncio.wait_for(
        asyncio.gather(
            post_refresh_with_cookie(previous_cookie),
            post_refresh_with_cookie(current_cookie),
        ),
        timeout=10,
    )
    statuses = sorted([previous_response.status_code, current_response.status_code])

    assert statuses[0] == 200
    assert statuses[1] in (200, 409)
    for response in (previous_response, current_response):
        if response.status_code == 409:
            assert response.json()["detail"] == "Refresh token was already rotated"
            assert "refresh_token" not in response.cookies

    async with TestSession() as session:
        token_result = await session.execute(select(AuthToken))
        tokens = token_result.scalars().all()
        refresh_tokens = [token for token in tokens if token.token_kind == AuthTokenKind.REFRESH]
        access_tokens = [token for token in tokens if token.token_kind == AuthTokenKind.ACCESS]
        assert len(refresh_tokens) == 2
        assert len(access_tokens) == 1


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


async def test_refresh_token_with_access_use_claim_returns_401(client):
    """A refresh-signed token with the wrong use claim is rejected"""
    await _create_user(client)

    async with TestSession() as session:
        result = await session.execute(select(AuthToken).where(AuthToken.token_kind == AuthTokenKind.REFRESH))
        refresh_token_row = result.scalar_one()
        token = _encode_auth_test_token(
            private_key=JWT_REFRESH_PRIVATE_KEY,
            user_id=refresh_token_row.user_id,
            token_id=refresh_token_row.jti,
            session_id=refresh_token_row.session_id,
            token_use=AuthTokenKind.ACCESS.value,
        )

    client.cookies.set("refresh_token", token)
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired refresh token"


async def test_refresh_token_with_mismatched_session_claim_returns_401(client):
    """A refresh token whose sid claim does not match the allowlist row is rejected"""
    await _create_user(client)

    async with TestSession() as session:
        result = await session.execute(select(AuthToken).where(AuthToken.token_kind == AuthTokenKind.REFRESH))
        refresh_token_row = result.scalar_one()
        token = _encode_auth_test_token(
            private_key=JWT_REFRESH_PRIVATE_KEY,
            user_id=refresh_token_row.user_id,
            token_id=refresh_token_row.jti,
            session_id=uuid4(),
            token_use=AuthTokenKind.REFRESH.value,
        )

    client.cookies.set("refresh_token", token)
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid token"


async def test_refresh_token_with_mismatched_subject_claim_returns_401(client):
    """A refresh token whose sub claim does not match the allowlist row is rejected"""
    await _create_user(client)

    async with TestSession() as session:
        result = await session.execute(select(AuthToken).where(AuthToken.token_kind == AuthTokenKind.REFRESH))
        refresh_token_row = result.scalar_one()
        token = _encode_auth_test_token(
            private_key=JWT_REFRESH_PRIVATE_KEY,
            user_id=uuid4(),
            token_id=refresh_token_row.jti,
            session_id=refresh_token_row.session_id,
            token_use=AuthTokenKind.REFRESH.value,
        )

    client.cookies.set("refresh_token", token)
    resp = await client.post("/auth/refresh")

    # The token and session lookups are scoped by the claimed user, so a mismatched
    # subject finds no session for that user rather than matching the real owner's row
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Session is not active"


async def test_refresh_rejects_expired_session_with_active_token_row(client):
    """Refresh fails when the session is expired even if the token row is active"""
    signup_resp = await _create_user(client)
    refresh_cookie = signup_resp.cookies["refresh_token"]

    async with TestSession() as session:
        result = await session.execute(select(AuthSession))
        auth_session = result.scalar_one()
        auth_session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    client.cookies.set("refresh_token", refresh_cookie)
    resp = await client.post("/auth/refresh")

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Session is not active"


async def test_refresh_revokes_old_access_token(client):
    """After refresh, the old access token is removed from the auth token allowlist"""
    signup_resp = await _create_user(client)
    old_access_token = signup_resp.json()["access_token"]
    refresh_cookie = signup_resp.cookies["refresh_token"]

    async with TestSession() as session:
        result = await session.execute(select(AuthToken))
        old_tokens = result.scalars().all()
        old_access_jti = next(token.jti for token in old_tokens if token.token_kind == AuthTokenKind.ACCESS)
        old_refresh_jti = next(token.jti for token in old_tokens if token.token_kind == AuthTokenKind.REFRESH)

    client.cookies.set("refresh_token", refresh_cookie)
    refresh_resp = await client.post("/auth/refresh")
    assert refresh_resp.status_code == 200

    new_access_token = refresh_resp.json()["access_token"]

    async with TestSession() as session:
        result = await session.execute(select(AuthToken))
        new_tokens = result.scalars().all()
        new_jtis = {token.jti for token in new_tokens}
        refresh_tokens = [token for token in new_tokens if token.token_kind == AuthTokenKind.REFRESH]
        access_tokens = [token for token in new_tokens if token.token_kind == AuthTokenKind.ACCESS]
        assert len(refresh_tokens) == 2
        assert len(access_tokens) == 1
        assert old_access_jti not in new_jtis
        assert old_refresh_jti in new_jtis

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {old_access_token}"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Token is not active"

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {new_access_token}"})
    assert resp.status_code == 200


async def test_expired_tokens_purged_on_token_issuance(client):
    """Expired auth token rows are cleaned up when new tokens are issued"""
    await _create_user(client)

    # Seed an expired token directly in the DB
    expired_jti = uuid4()
    async with TestSession() as session:
        user_result = await session.execute(select(User))
        user = user_result.scalars().first()

        auth_session = AuthSession(
            user_id=user.id,
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        session.add(auth_session)
        await session.flush()

        session.add(AuthToken(
            jti=expired_jti,
            user_id=user.id,
            session_id=auth_session.id,
            token_kind=AuthTokenKind.ACCESS,
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        ))
        await session.commit()

    # 2 valid signup tokens + 1 expired = 3 total
    async with TestSession() as session:
        result = await session.execute(select(AuthToken))
        assert len(result.scalars().all()) == 3

    # Login triggers token issuance, which purges expired rows
    login_resp = await client.post(
        "/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]},
    )
    assert login_resp.status_code == 200

    async with TestSession() as session:
        # The expired token should be gone
        result = await session.execute(select(AuthToken).where(AuthToken.jti == expired_jti))
        assert result.scalar_one_or_none() is None

        # Valid tokens survive: 2 from signup + 2 from login = 4
        result = await session.execute(select(AuthToken))
        assert len(result.scalars().all()) == 4


# --- Logout ---


async def test_logout_revokes_tokens_and_clears_cookie(client):
    """Logout removes the session and its token allowlist rows"""
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

    # The session and its tokens should be removed from the allowlist
    async with TestSession() as session:
        token_result = await session.execute(select(AuthToken))
        session_result = await session.execute(select(AuthSession))
        assert len(token_result.scalars().all()) == 0
        assert len(session_result.scalars().all()) == 0


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


async def test_logout_without_auth_header_returns_200(client):
    """Logout without an Authorization header still clears the refresh cookie"""
    resp = await client.post("/auth/logout")

    assert resp.status_code == 200
    assert resp.json()["detail"] == "Logged out"


async def test_logout_with_refresh_cookie_only_revokes_session(client):
    """Logout can revoke a session using only the refresh cookie"""
    signup_resp = await _create_user(client)
    refresh_cookie = signup_resp.cookies["refresh_token"]

    client.cookies.set("refresh_token", refresh_cookie)
    resp = await client.post("/auth/logout")

    assert resp.status_code == 200
    assert resp.json()["detail"] == "Logged out"

    async with TestSession() as session:
        token_result = await session.execute(select(AuthToken))
        session_result = await session.execute(select(AuthSession))
        assert len(token_result.scalars().all()) == 0
        assert len(session_result.scalars().all()) == 0


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

    # The session should be gone even though the cookie was never sent
    async with TestSession() as session:
        token_result = await session.execute(select(AuthToken))
        session_result = await session.execute(select(AuthSession))
        assert len(token_result.scalars().all()) == 0
        assert len(session_result.scalars().all()) == 0


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

        # Two sessions x two token rows each = 4 auth_tokens rows
        async with TestSession() as db:
            token_result = await db.execute(select(AuthToken))
            session_result = await db.execute(select(AuthSession))
            assert len(token_result.scalars().all()) == 4
            assert len(session_result.scalars().all()) == 2

        # Logout session 1
        resp = await client.post("/auth/logout", headers={"Authorization": f"Bearer {session1_access}"})
        assert resp.status_code == 200

        # Session 2's rows survive
        async with TestSession() as db:
            token_result = await db.execute(select(AuthToken))
            session_result = await db.execute(select(AuthSession))
            assert len(token_result.scalars().all()) == 2
            assert len(session_result.scalars().all()) == 1

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


async def test_access_token_with_refresh_use_claim_returns_401(client):
    """An access-signed token with the wrong use claim is rejected by the token_use guard

    The audience is aligned to access so the token clears the audience check, isolating the token_use
    guard as the barrier that rejects it, the redundant backup behind the audience segregation
    """
    await _create_user(client)

    async with TestSession() as session:
        result = await session.execute(select(AuthToken).where(AuthToken.token_kind == AuthTokenKind.ACCESS))
        access_token_row = result.scalar_one()
        token = _encode_auth_test_token(
            private_key=JWT_ACCESS_PRIVATE_KEY,
            user_id=access_token_row.user_id,
            token_id=access_token_row.jti,
            session_id=access_token_row.session_id,
            token_use=AuthTokenKind.REFRESH.value,
            aud=AuthTokenKind.ACCESS.value,
        )

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid token"


async def test_set_password_grant_rejected_as_access_token(client):
    """A set-password authorization grant cannot authenticate as an access token

    The grant is a genuine, correctly signed token, so only its distinct audience stops it standing in
    for an access token at the bearer check
    """
    from app.services.auth.tokens import create_set_password_authz_token

    await _create_user(client)
    grant = create_set_password_authz_token(uuid4())

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {grant}"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired token"


async def test_access_token_with_mismatched_session_claim_returns_401(client):
    """An access token whose sid claim does not match the allowlist row is rejected"""
    await _create_user(client)

    async with TestSession() as session:
        result = await session.execute(select(AuthToken).where(AuthToken.token_kind == AuthTokenKind.ACCESS))
        access_token_row = result.scalar_one()
        token = _encode_auth_test_token(
            private_key=JWT_ACCESS_PRIVATE_KEY,
            user_id=access_token_row.user_id,
            token_id=access_token_row.jti,
            session_id=uuid4(),
            token_use=AuthTokenKind.ACCESS.value,
        )

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Token is not active"


async def test_access_token_with_mismatched_subject_claim_returns_401(client):
    """An access token whose sub claim does not match the allowlist row is rejected"""
    await _create_user(client)

    async with TestSession() as session:
        result = await session.execute(select(AuthToken).where(AuthToken.token_kind == AuthTokenKind.ACCESS))
        access_token_row = result.scalar_one()
        token = _encode_auth_test_token(
            private_key=JWT_ACCESS_PRIVATE_KEY,
            user_id=uuid4(),
            token_id=access_token_row.jti,
            session_id=access_token_row.session_id,
            token_use=AuthTokenKind.ACCESS.value,
        )

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Token is not active"


async def test_access_token_rejects_expired_session_with_active_token_row(client):
    """Access fails when the session is expired even if the token row is active"""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]

    async with TestSession() as session:
        result = await session.execute(select(AuthSession))
        auth_session = result.scalar_one()
        auth_session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    resp = await client.get("/test/me", headers={"Authorization": f"Bearer {access_token}"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Session is not active"


async def test_revoked_access_token_returns_401(client):
    """An access token from a deleted session is rejected"""
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
