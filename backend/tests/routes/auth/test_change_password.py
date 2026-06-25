"""Change-password route tests"""

import uuid

from app.models.auth import PasswordCredential
from app.services.auth.password_helpers import is_password_valid
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header

_NEW_PASSWORD = "NewSecurePass123!"


async def test_change_password_updates_credential(client):
    """A valid change replaces the stored hash so the new password authenticates"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)

    resp = await client.patch(
        "/auth/password",
        json={"current_password": SIGNUP_PAYLOAD["password"], "new_password": _NEW_PASSWORD},
        headers=headers,
    )

    assert resp.status_code == 204

    user_id = uuid.UUID(signup.json()["user"]["id"])
    async with TestSession() as session:
        credential = await session.get(PasswordCredential, user_id)
        assert is_password_valid(_NEW_PASSWORD, credential.password_hash)
        assert not is_password_valid(SIGNUP_PAYLOAD["password"], credential.password_hash)


async def test_change_password_rejects_wrong_current_password(client):
    """A wrong current password is rejected with no change to the stored hash"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)

    resp = await client.patch(
        "/auth/password",
        json={"current_password": "WrongPassword123!", "new_password": _NEW_PASSWORD},
        headers=headers,
    )

    assert resp.status_code == 401

    user_id = uuid.UUID(signup.json()["user"]["id"])
    async with TestSession() as session:
        credential = await session.get(PasswordCredential, user_id)
        assert is_password_valid(SIGNUP_PAYLOAD["password"], credential.password_hash)


async def test_change_password_rejects_weak_new_password(client):
    """A new password that fails the policy is rejected before any update"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)

    resp = await client.patch(
        "/auth/password",
        json={"current_password": SIGNUP_PAYLOAD["password"], "new_password": "weak"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_change_password_requires_authentication(client):
    """The endpoint rejects callers without a bearer token"""
    resp = await client.patch(
        "/auth/password",
        json={"current_password": SIGNUP_PAYLOAD["password"], "new_password": _NEW_PASSWORD},
    )

    assert resp.status_code == 401
