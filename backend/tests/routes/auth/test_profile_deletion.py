"""Deleting a profile, confirmed with the password and any current second factor"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select, update

from app.models.account import Account
from app.models.auth import EmailChangeRequest, PasswordCredential, PasswordResetToken, TotpCredential
from app.models.auth_session import AuthSession
from app.models.bank_connection import BankConnection
from app.models.user import User
from app.services.auth.mfa_challenge import issue_reauth_stepup_proof
from app.services.profile_deletion import request as request_module
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _create_user,
    _enroll,
    _fresh_totp_code,
    _get_auth_header,
    _link_sign_in_providers,
    _seed_reset_token,
    _sign_in_again,
    sign_up_confirmed,
)
from tests.routes.support.authorization_helpers import OLD_ACCESS, _commit_rejected_connection
from tests.routes.support.bank_sync_helpers import _build_account
from tests.routes.support.deletion_helpers import _user_exists

_PASSWORD = SIGNUP_PAYLOAD["password"]
_DELETE = "/auth/profile/delete"


async def _skip_deletion(*_args) -> None:
    """Stands in for the deletion after the answer, so a test sees the state the request alone leaves"""


async def _commit_account(owner_id: uuid.UUID) -> None:
    """Commit a personal account for the user"""
    async with TestSession() as session:
        session.add(_build_account(owner_id))
        await session.commit()


async def test_delete_with_password_removes_the_profile_and_signs_out_everywhere(client, profile_deletions):
    """The password deletes the user, their rows and every session, clears the cookie, and another user keeps everything"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    headers = _get_auth_header(signup)
    other_device = await _sign_in_again(client)
    bystander = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "bystander@example.com"})
    bystander_id = uuid.UUID(bystander.json()["user"]["id"])
    await _commit_account(user_id)
    await _commit_account(bystander_id)

    response = await client.post(_DELETE, headers=headers, json={"password": _PASSWORD})

    assert response.status_code == 204, response.text
    assert 'refresh_token=""' in response.headers["set-cookie"]
    assert not await _user_exists(user_id)
    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(Account).where(Account.owner_id == user_id)) == 0
        assert await session.scalar(select(func.count()).select_from(Account).where(Account.owner_id == bystander_id)) == 1
    assert [deletion.user_id for deletion in profile_deletions] == [user_id]
    assert (await client.get("/auth/2fa/status", headers=other_device[0])).status_code == 401
    assert (await client.get("/auth/2fa/status", headers=_get_auth_header(bystander))).status_code == 200

    sign_in = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert sign_in.status_code == 401


async def test_delete_without_step_up_or_with_a_wrong_password_keeps_the_profile(client, profile_deletions):
    """No step-up, or a wrong password, deletes nothing and keeps the session"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    headers = _get_auth_header(signup)

    missing = await client.post(_DELETE, headers=headers)
    assert missing.status_code == 401
    assert missing.json()["detail"] == "Reauthentication required"

    wrong = await client.post(_DELETE, headers=headers, json={"password": "WrongPassword123!"})
    assert wrong.status_code == 401
    assert wrong.json()["detail"] == "Invalid credentials"

    assert await _user_exists(user_id)
    assert profile_deletions == []
    assert (await client.get("/auth/2fa/status", headers=headers)).status_code == 200


async def test_delete_gives_each_bank_connections_access_back(client, authorizing_provider):
    """Every connection goes, and the access each one stored is released to its provider"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    await _commit_rejected_connection(user_id)
    await _commit_rejected_connection(user_id, rejected=False)

    response = await client.post(_DELETE, headers=_get_auth_header(signup), json={"password": _PASSWORD})

    assert response.status_code == 204, response.text
    assert authorizing_provider.released == [OLD_ACCESS, OLD_ACCESS]
    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(BankConnection)) == 0


async def test_delete_finishes_when_a_provider_refuses_the_access_back(client, authorizing_provider, profile_deletions):
    """A provider that fails to take the access back doesn't stop the deletion"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    await _commit_rejected_connection(user_id)
    authorizing_provider.release_error = RuntimeError("provider down")

    response = await client.post(_DELETE, headers=_get_auth_header(signup), json={"password": _PASSWORD})

    assert response.status_code == 204, response.text
    assert not await _user_exists(user_id)
    assert [deletion.user_id for deletion in profile_deletions] == [user_id]


async def test_a_profile_marked_for_deletion_cannot_sign_in_or_renew(client):
    """While the deletion is still running, the password and the refresh cookie are both refused as bad credentials are"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    refresh_cookie = signup.cookies["refresh_token"]
    async with TestSession() as session:
        await session.execute(update(User).where(User.id == user_id).values(deletion_requested_at=datetime.now(UTC)))
        await session.commit()

    sign_in = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert sign_in.status_code == 401
    assert sign_in.json()["detail"] == "Invalid credentials"

    client.cookies.set("refresh_token", refresh_cookie)
    renewal = await client.post("/auth/refresh")
    assert renewal.status_code == 401


async def test_the_request_ends_sessions_and_emailed_links_before_the_data_goes(client, monkeypatch):
    """Once the request answers, the user is marked and every session, reset link and email change is gone, before the data goes"""
    monkeypatch.setattr(request_module, "delete_profile", _skip_deletion)
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    headers = _get_auth_header(signup)
    other_device = await _sign_in_again(client)
    await _seed_reset_token(user_id)
    changed = await client.post(
        "/auth/email/change", headers=headers, json={"new_email": "new.address@example.com", "step_up": {"password": _PASSWORD}}
    )
    assert changed.status_code == 204, changed.text

    response = await client.post(_DELETE, headers=headers, json={"password": _PASSWORD})

    assert response.status_code == 204, response.text
    async with TestSession() as session:
        user = await session.get(User, user_id)
        assert user is not None and user.deletion_requested_at is not None
        for model in (AuthSession, PasswordResetToken, EmailChangeRequest):
            assert await session.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) == 0
    for device in (headers, other_device[0]):
        assert (await client.get("/auth/2fa/status", headers=device)).status_code == 401


async def test_delete_passwordless_needs_a_fresh_provider_proof(client, profile_deletions):
    """With no password to send, the proof of a fresh provider sign-in deletes the profile, and a missing proof does not"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    headers = _get_auth_header(signup)
    await _link_sign_in_providers(user_id, 1)
    async with TestSession() as session:
        await session.execute(delete(PasswordCredential).where(PasswordCredential.user_id == user_id))
        await session.commit()

    refused = await client.post(_DELETE, headers=headers)
    assert refused.status_code == 401
    assert refused.json()["detail"] == "Reauthentication required"
    assert await _user_exists(user_id)

    async with TestSession() as session:
        proof = await issue_reauth_stepup_proof(session, user_id)
    client.cookies.set("oidc_reauth_stepup", proof)
    accepted = await client.post(_DELETE, headers=headers)

    assert accepted.status_code == 204, accepted.text
    assert not await _user_exists(user_id)
    assert [deletion.user_id for deletion in profile_deletions] == [user_id]


async def test_delete_with_a_second_factor_on_needs_its_code(client, profile_deletions):
    """The password alone does not delete an account with a second factor, and the password with a current code does"""
    headers, secret, _ = await _enroll(client)

    password_only = await client.post(_DELETE, headers=headers, json={"password": _PASSWORD})
    assert password_only.status_code == 400
    assert password_only.json()["detail"] == "A second factor is required"
    assert profile_deletions == []

    # Enrolment spent the code's step, so free it for the step-up
    async with TestSession() as session:
        await session.execute(update(TotpCredential).values(last_used_step=None))
        await session.commit()
    accepted = await client.post(_DELETE, headers=headers, json={"password": _PASSWORD, "code": _fresh_totp_code(secret)})

    assert accepted.status_code == 204, accepted.text
    assert len(profile_deletions) == 1
