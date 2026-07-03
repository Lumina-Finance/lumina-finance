"""Password reset request and consume route tests"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.models.auth import PasswordResetToken
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header

_NEW_PASSWORD = "NewSecurePass123!"


async def _reset_tokens_for(user_id):
    """Return the reset token rows owned by a user"""
    async with TestSession() as session:
        result = await session.execute(select(PasswordResetToken).where(PasswordResetToken.user_id == user_id))
        return result.scalars().all()


async def _seed_reset_token(user_id, raw_token="reset-token-abc", *, expires_in_seconds=600, used=False):  # noqa: S107
    """Insert a reset token row with a known raw value so the consume route can be exercised"""
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    async with TestSession() as session:
        session.add(PasswordResetToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in_seconds),
            used_at=datetime.now(UTC) if used else None,
        ))
        await session.commit()
    return raw_token


async def test_forgot_password_issues_token_for_existing_user(client):
    """A known email gets a single unused reset token"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])

    resp = await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})

    assert resp.status_code == 204
    rows = await _reset_tokens_for(user_id)
    assert len(rows) == 1
    assert rows[0].used_at is None


async def test_forgot_password_unknown_email_creates_no_token(client):
    """An unknown email still returns 204 but issues no token, avoiding enumeration"""
    resp = await client.post("/auth/password/forgot", json={"email": "nobody@example.com"})

    assert resp.status_code == 204
    async with TestSession() as session:
        token_count = await session.scalar(select(func.count()).select_from(PasswordResetToken))
        assert token_count == 0


async def test_forgot_password_supersedes_prior_token(client):
    """Requesting again replaces the earlier token so only the latest link stays valid"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])

    await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})
    first_hash = (await _reset_tokens_for(user_id))[0].token_hash

    await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})
    rows = await _reset_tokens_for(user_id)

    assert len(rows) == 1
    assert rows[0].token_hash != first_hash


async def test_reset_password_sets_new_password_and_consumes_token(client):
    """A valid token sets the new password, which then authenticates, and marks the token used"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token = await _seed_reset_token(user_id)

    resp = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert resp.status_code == 204

    login = await client.post(
        "/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _NEW_PASSWORD},
    )
    assert login.status_code == 200

    rows = await _reset_tokens_for(user_id)
    assert rows[0].used_at is not None


async def test_reset_password_revokes_existing_sessions(client):
    """A reset ends every prior session so the pre-reset access token stops working"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    pre_reset_headers = _get_auth_header(signup)
    raw_token = await _seed_reset_token(user_id)

    resp = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert resp.status_code == 204

    revoked = await client.patch(
        "/auth/password",
        json={"current_password": _NEW_PASSWORD, "new_password": "AnotherSecret123!"},
        headers=pre_reset_headers,
    )
    assert revoked.status_code == 401


async def test_reset_password_rejects_expired_token(client):
    """An expired token is rejected"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token = await _seed_reset_token(user_id, expires_in_seconds=-60)

    resp = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert resp.status_code == 400


async def test_reset_password_rejects_used_token(client):
    """An already-used token cannot be reused"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token = await _seed_reset_token(user_id, used=True)

    resp = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert resp.status_code == 400


async def test_reset_password_rejects_unknown_token(client):
    """A token that matches no row is rejected"""
    await _create_user(client)

    resp = await client.post("/auth/password/reset", json={"token": "does-not-exist", "new_password": _NEW_PASSWORD})
    assert resp.status_code == 400


async def test_reset_password_rejects_weak_new_password(client):
    """A new password that fails the policy is rejected before the token is consumed"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token = await _seed_reset_token(user_id)

    resp = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": "weak"})
    assert resp.status_code == 422

    rows = await _reset_tokens_for(user_id)
    assert rows[0].used_at is None
