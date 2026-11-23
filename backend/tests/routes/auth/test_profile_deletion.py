"""Deleting a profile, confirmed with the password and any current second factor"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select, update

from app.models.account import Account
from app.models.bank_connection import BankConnection
from app.models.user import User
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header, _sign_in_again, sign_up_confirmed
from tests.routes.support.authorization_helpers import OLD_ACCESS, _commit_rejected_connection
from tests.routes.support.bank_sync_helpers import _build_account
from tests.services.bank_sync.authorizing_provider import AuthorizingProviderAdapter
from tests.services.bank_sync.fake_provider import use_adapter

_PASSWORD = SIGNUP_PAYLOAD["password"]
_DELETE = "/auth/profile/delete"


@pytest.fixture
def authorizing_provider(no_bank_provider, monkeypatch) -> AuthorizingProviderAdapter:
    """Install the scripted provider that records each access it is given back, as the only provider"""
    adapter = AuthorizingProviderAdapter()
    use_adapter(monkeypatch, adapter)
    return adapter


async def _user_exists(user_id: uuid.UUID) -> bool:
    """Whether the user row is still there"""
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(User).where(User.id == user_id)) == 1


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
