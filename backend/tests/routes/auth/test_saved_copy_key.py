"""Saved copy key tests: a browser gets one key per user, a native app none, and ending sessions rotates it"""

import uuid

import pyotp
import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError

from app import encryption
from app.db.rls.functions import ROTATE_SAVED_COPY_KEY
from app.models.auth import LoginLockout, PasswordCredential
from app.models.auth_session import AuthSession
from app.models.user import User
from app.services.auth import sessions
from app.services.auth.password_helpers import is_password_valid
from app.services.auth.saved_copy_key import derive_saved_copy_key
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _create_user,
    _enroll,
    _fresh_totp_code,
    _get_auth_header,
    _saved_copy_key,
    _seed_reset_token,
    sign_up_confirmed,
)
from tests.routes.support.identity_helpers import _act_as, _seed_users

_PASSWORD = SIGNUP_PAYLOAD["password"]
_NEW_PASSWORD = "NewSecurePass123!"
_NATIVE = {"X-Lumina-Client": "native"}
_LOGIN = {"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD}

# The 32 bytes 0 to 31 as a Fernet key, whose derived key was worked out with openssl's HKDF
_KNOWN_ROOT_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

# 32 bytes as unpadded base64url
_KEY_LENGTH = 43
_ATTEMPTS_BEFORE_LOCK = 5


async def _login(client, password: str = _PASSWORD):
    """Sign the default user in with a password, as a browser"""
    return await client.post("/auth/login", json={**_LOGIN, "password": password})


async def _stored_key_number(user_id: str) -> int:
    """Return the key number the database holds for a user"""
    async with TestSession() as session:
        return await session.scalar(select(User.saved_copy_key_version).where(User.id == uuid.UUID(user_id)))


async def _recovery_code_login(client, code: str):
    """Sign in past the password step with a recovery code, returning the verify response"""
    login = await _login(client)
    return await client.post("/auth/2fa/verify", json={"mfa_token": login.json()["mfa_token"], "code": code})


async def test_a_browser_gets_the_key_on_every_way_of_signing_in_and_on_renewal(client):
    """Password sign-in, sign-up confirmation, the second step of a two-step sign-in and renewal all carry one key"""
    signup = await _create_user(client)
    key, version = _saved_copy_key(signup)
    assert len(key) == _KEY_LENGTH, "sign-up confirmation returns a 32-byte base64url key"
    assert version == 0, "a new account starts at key number 0"

    assert _saved_copy_key(await _login(client)) == (key, version), "password sign-in returns the same key"

    client.cookies.set("refresh_token", signup.cookies["refresh_token"])
    renewal = await client.post("/auth/refresh")
    assert _saved_copy_key(renewal) == (key, version), "session renewal returns the same key"

    auth = _get_auth_header(renewal)
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": {"password": _PASSWORD}})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    challenge = await _login(client)
    assert "saved_copy_key" not in challenge.json(), "the first step of a two-step sign-in hands out no key"
    verify = await client.post("/auth/2fa/verify", json={"mfa_token": challenge.json()["mfa_token"], "code": _fresh_totp_code(secret)})
    assert _saved_copy_key(verify) == (key, version), "the second step returns the same key"


async def test_a_native_app_gets_no_key(client):
    """A native sign-in and renewal leave both fields out of the body, as they do a cookie"""
    await _create_user(client)
    client.cookies.clear()

    login = await client.post("/auth/login", json=_LOGIN, headers=_NATIVE)
    assert login.status_code == 200
    assert "saved_copy_key" not in login.json()
    assert "saved_copy_key_version" not in login.json()

    renewal = await client.post("/auth/refresh", json={"refresh_token": login.json()["refresh_token"]}, headers=_NATIVE)
    assert renewal.status_code == 200
    assert "saved_copy_key" not in renewal.json()
    assert "saved_copy_key_version" not in renewal.json()


async def test_the_key_is_the_same_for_a_users_sessions_and_different_between_users(client):
    """One user's sessions share a key, and another user's key differs, so one leak opens one user's copy"""
    first = await _create_user(client)
    second_session = await _login(client)
    other = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "other@example.com"})

    first_key, _ = _saved_copy_key(first)
    assert _saved_copy_key(second_session)[0] == first_key
    assert _saved_copy_key(other)[0] != first_key


async def _change_password(client, signup) -> str:
    """Change the password from the signed-up session, returning the new password"""
    resp = await client.patch(
        "/auth/password",
        json={"current_password": _PASSWORD, "new_password": _NEW_PASSWORD},
        headers=_get_auth_header(signup),
    )
    assert resp.status_code == 204
    return _NEW_PASSWORD


async def _reset_password(client, signup) -> str:
    """Reset the password with a link, returning the new password"""
    raw_token = await _seed_reset_token(uuid.UUID(signup.json()["user"]["id"]))
    resp = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert resp.status_code == 204
    return _NEW_PASSWORD


async def _lock_out(client, signup) -> str:
    """Lock the account with wrong passwords, then lift the lock so the owner can sign in, returning the password"""
    for _ in range(_ATTEMPTS_BEFORE_LOCK):
        await _login(client, "wrong-password")
    assert (await _login(client)).status_code == 423, "the account is locked"

    async with TestSession() as session:
        await session.execute(delete(LoginLockout))
        await session.commit()
    return _PASSWORD


@pytest.mark.parametrize("action", [_change_password, _reset_password, _lock_out], ids=["change", "reset", "lockout"])
async def test_ending_a_users_other_sessions_gives_a_new_key_and_never_the_old_one_again(client, action):
    """Each password-based way of ending sessions raises the number, and the next sign-ins get the new key"""
    signup = await _create_user(client)
    old_key, old_version = _saved_copy_key(signup)
    user_id = signup.json()["user"]["id"]

    password = await action(client, signup)

    assert await _stored_key_number(user_id) == old_version + 1
    new_key, new_version = _saved_copy_key(await _login(client, password))
    assert new_version == old_version + 1
    assert new_key != old_key
    assert new_key == derive_saved_copy_key(uuid.UUID(user_id), new_version)
    assert _saved_copy_key(await _login(client, password)) == (new_key, new_version), "every later sign-in keeps the new key"


async def test_the_session_that_changes_the_password_renews_onto_the_new_key(client):
    """The session that stays signed in gets the new key on its next renewal, so it can save again"""
    signup = await _create_user(client)
    old_key, _ = _saved_copy_key(signup)
    await _change_password(client, signup)

    client.cookies.set("refresh_token", signup.cookies["refresh_token"])
    renewal = await client.post("/auth/refresh")

    assert renewal.status_code == 200
    new_key, new_version = _saved_copy_key(renewal)
    assert new_version == 1
    assert new_key != old_key


async def test_rotating_one_users_key_leaves_another_users_key_alone(client):
    """A password change moves only its own user's number"""
    first = await _create_user(client)
    other = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "other@example.com"})
    other_key = _saved_copy_key(other)

    await _change_password(client, first)

    other_login = await client.post("/auth/login", json={"email": "other@example.com", "password": _PASSWORD})
    assert _saved_copy_key(other_login) == other_key


async def test_a_recovery_code_sign_in_answers_with_the_new_key_and_completing_re_enrolment_rotates_again(client):
    """The response that ends the other sessions carries the new key, and the re-enrol that signs out everywhere moves it on"""
    _, _, codes = await _enroll(client)
    async with TestSession() as session:
        user_id = await session.scalar(select(User.id).where(User.email == SIGNUP_PAYLOAD["email"]))
    start_key = derive_saved_copy_key(user_id, 0)

    verify = await _recovery_code_login(client, codes[0])
    assert verify.status_code == 200
    recovered_key, recovered_version = _saved_copy_key(verify)
    assert recovered_version == 1, "the rotating response carries the new number"
    assert recovered_key != start_key
    assert recovered_key == derive_saved_copy_key(user_id, 1)

    restricted = {"Authorization": f"Bearer {verify.json()['access_token']}"}
    secret = (await client.post("/auth/2fa/setup", headers=restricted, json={})).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=restricted, json={"code": pyotp.TOTP(secret).now()})
    assert confirm.status_code == 200
    assert (await client.post("/auth/2fa/complete", headers=restricted)).status_code == 204

    relogin = await _login(client)
    final = await client.post("/auth/2fa/verify", json={"mfa_token": relogin.json()["mfa_token"], "code": _fresh_totp_code(secret)})
    final_key, final_version = _saved_copy_key(final)
    assert final_version == 2
    assert final_key not in (start_key, recovered_key)


def _rotate(user_id):
    """Return the statement calling the rotation function for a user"""
    return text(f"SELECT {ROTATE_SAVED_COPY_KEY}(:user_id)").bindparams(user_id=user_id)


async def test_the_rotation_function_refuses_another_signed_in_user_and_changes_nothing(client):
    """A request signed in as one user can't raise another user's number"""
    user_a, user_b = await _seed_users("a@example.com", "b@example.com")

    async with _act_as(user_a.id) as session:
        with pytest.raises(DBAPIError, match="Not authorized to rotate the saved copy key"):
            await session.execute(_rotate(user_b.id))

    assert await _stored_key_number(str(user_b.id)) == 0


async def test_the_rotation_function_raises_the_number_of_the_signed_in_user_only(client):
    """A signed-in user rotates their own key by exactly one, and no other user's"""
    user_a, user_b = await _seed_users("a@example.com", "b@example.com")

    async with _act_as(user_a.id) as session:
        await session.execute(_rotate(user_a.id))
        await session.commit()

    assert await _stored_key_number(str(user_a.id)) == 1
    assert await _stored_key_number(str(user_b.id)) == 0


async def test_the_rotation_function_runs_with_no_identity_set(client):
    """The lockout that ends a user's sessions runs before anyone is signed in, so it must still rotate"""
    (user,) = await _seed_users("a@example.com")

    async with _act_as(None) as session:
        await session.execute(_rotate(user.id))
        await session.commit()

    assert await _stored_key_number(str(user.id)) == 1


async def test_signing_out_keeps_the_key_and_number(client):
    """Plain sign-out deletes only that browser's copy, so signing in again returns the same key"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]

    client.cookies.set("refresh_token", signup.cookies["refresh_token"])
    assert (await client.post("/auth/logout")).status_code == 200

    assert _saved_copy_key(await _login(client)) == _saved_copy_key(signup)
    assert await _stored_key_number(user_id) == 0


async def test_a_rotation_failing_in_the_database_rolls_back_the_whole_password_change(client, monkeypatch):
    """The password, the other sessions and the key number change together or not at all"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    other_session = await _login(client)
    rotate = sessions._rotate_saved_copy_key

    async def rotate_then_fail(db, rotating_user_id):
        await rotate(db, rotating_user_id)
        await db.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(sessions, "_rotate_saved_copy_key", rotate_then_fail)
    with pytest.raises(DBAPIError, match="division by zero"):
        await client.patch(
            "/auth/password",
            json={"current_password": _PASSWORD, "new_password": _NEW_PASSWORD},
            headers=_get_auth_header(signup),
        )
    monkeypatch.undo()

    async with TestSession() as session:
        credential = await session.get(PasswordCredential, user_id)
        session_count = await session.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.user_id == user_id))
    assert is_password_valid(_PASSWORD, credential.password_hash), "the password is unchanged"
    assert session_count == 2, "the other session is still signed in"
    assert await _stored_key_number(str(user_id)) == 0
    assert (await client.get("/auth/2fa/status", headers=_get_auth_header(other_session))).status_code == 200


@pytest.fixture
def known_root_key(tmp_path, monkeypatch):
    """Make the known key the app's key, with the persisted key file pointed at an empty folder

    A machine holding a key file at the real path would otherwise conflict with the environment key
    """
    monkeypatch.setattr(encryption, "_SECRETS_DIR", tmp_path)
    monkeypatch.setattr(encryption, "KEY_FILE", tmp_path / "app_encryption_key")
    monkeypatch.setenv(encryption.KEY_ENV_VAR, _KNOWN_ROOT_KEY)
    encryption._app_key.cache_clear()
    yield
    encryption._app_key.cache_clear()


async def test_the_derivation_is_pinned_for_a_known_root_key_user_and_number(known_root_key):
    """Saved copies must keep decrypting across deploys, so a given key, user and number always derive the same key"""
    derived = derive_saved_copy_key(uuid.UUID("12345678-1234-5678-1234-567812345678"), 3)

    assert derived == "zkDtTwHMtZ1Y7JeD5U91VX9iOfMvQ6o_QPG3wyaI6J0"
