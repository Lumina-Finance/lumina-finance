"""Change-password route tests"""

import uuid

import pyotp
from sqlalchemy import select

from app.models.auth import PasswordCredential
from app.models.auth_session import AuthSession
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


async def test_change_password_revokes_other_sessions(client):
    """A change signs out the user's other sessions while keeping the current one"""
    signup = await _create_user(client)
    current_headers = _get_auth_header(signup)

    # A second login opens another active session for the same user
    second_login = await client.post(
        "/auth/login",
        json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]},
    )
    other_headers = _get_auth_header(second_login)

    resp = await client.patch(
        "/auth/password",
        json={"current_password": SIGNUP_PAYLOAD["password"], "new_password": _NEW_PASSWORD},
        headers=current_headers,
    )
    assert resp.status_code == 204

    # The other session can no longer authenticate
    revoked = await client.patch(
        "/auth/password",
        json={"current_password": _NEW_PASSWORD, "new_password": "AnotherSecret123!"},
        headers=other_headers,
    )
    assert revoked.status_code == 401

    # The session that made the change is still active
    still_active = await client.patch(
        "/auth/password",
        json={"current_password": _NEW_PASSWORD, "new_password": "AnotherSecret123!"},
        headers=current_headers,
    )
    assert still_active.status_code == 204

    user_id = uuid.UUID(signup.json()["user"]["id"])
    async with TestSession() as session:
        result = await session.execute(select(AuthSession).where(AuthSession.user_id == user_id))
        assert len(result.scalars().all()) == 1


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


async def _enable_totp(client, headers):
    """Enrol the authenticated user in TOTP and return the secret"""
    secret = (await client.post("/auth/2fa/setup", headers=headers)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=headers, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=headers)
    return secret


async def test_change_password_requires_second_factor_when_totp_enabled(client):
    """With 2FA on, a missing code is rejected while a valid code lets the change through"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)
    secret = await _enable_totp(client, headers)

    without_code = await client.patch(
        "/auth/password",
        json={"current_password": SIGNUP_PAYLOAD["password"], "new_password": _NEW_PASSWORD},
        headers=headers,
    )
    assert without_code.status_code == 401

    with_code = await client.patch(
        "/auth/password",
        json={
            "current_password": SIGNUP_PAYLOAD["password"],
            "new_password": _NEW_PASSWORD,
            "code": pyotp.TOTP(secret).now(),
        },
        headers=headers,
    )
    assert with_code.status_code == 204


async def test_change_password_rejects_wrong_second_factor(client):
    """With 2FA on, a wrong code is rejected"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)
    await _enable_totp(client, headers)

    resp = await client.patch(
        "/auth/password",
        json={"current_password": SIGNUP_PAYLOAD["password"], "new_password": _NEW_PASSWORD, "code": "000000"},
        headers=headers,
    )
    assert resp.status_code == 401
