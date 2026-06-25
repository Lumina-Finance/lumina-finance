"""Password reset request route tests"""

import uuid

from sqlalchemy import func, select

from app.models.auth import PasswordResetToken
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user


async def _reset_tokens_for(user_id):
    """Return the reset token rows owned by a user"""
    async with TestSession() as session:
        result = await session.execute(select(PasswordResetToken).where(PasswordResetToken.user_id == user_id))
        return result.scalars().all()


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
