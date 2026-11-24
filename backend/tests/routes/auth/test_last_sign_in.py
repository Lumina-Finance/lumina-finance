"""The stored time a person last signed in or renewed a session, which code built on the app lists"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update

from app.models.user import User, UserLastSignIn
from app.services.auth import sessions
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _enroll, _fresh_totp_code, _refresh_session

_PASSWORD = SIGNUP_PAYLOAD["password"]
_CONFIRMED = datetime(2026, 3, 1, 14, 0, tzinfo=UTC)
_SIGNED_IN = datetime(2026, 3, 20, 9, 30, tzinfo=UTC)
_RENEWED = datetime(2026, 3, 21, 8, 0, tzinfo=UTC)


async def _last_signed_in_at(user_id: uuid.UUID) -> datetime | None:
    """The stored time, or None when the user has none"""
    async with TestSession() as session:
        return await session.scalar(select(UserLastSignIn.last_signed_in_at).where(UserLastSignIn.user_id == user_id))


async def test_confirming_a_sign_up_then_signing_in_then_renewing_each_store_their_time(client, freeze_now):
    """Confirming signs the person in, so it counts, and a later password sign-in and a renewal each move the time on"""
    freeze_now(sessions, _CONFIRMED)
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    assert await _last_signed_in_at(user_id) == _CONFIRMED, "confirming the sign-up is the first sign-in"

    freeze_now(sessions, _SIGNED_IN)
    sign_in = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert sign_in.status_code == 200, sign_in.text
    assert await _last_signed_in_at(user_id) == _SIGNED_IN, "a password sign-in moves the time"

    freeze_now(sessions, _RENEWED)
    renewal = await _refresh_session(client, sign_in.cookies["refresh_token"])
    assert renewal.status_code == 200, renewal.text
    assert await _last_signed_in_at(user_id) == _RENEWED, "a session renewal moves the time"


async def test_a_wrong_password_or_a_pending_second_factor_leaves_the_time(client, freeze_now):
    """Only a sign-in that issues a session counts, so a refused password or a code not yet given changes nothing"""
    freeze_now(sessions, _CONFIRMED)
    _auth, secret, _codes = await _enroll(client)
    async with TestSession() as session:
        user_id = await session.scalar(select(User.id).where(User.email == SIGNUP_PAYLOAD["email"]))
    assert await _last_signed_in_at(user_id) == _CONFIRMED

    freeze_now(sessions, _SIGNED_IN)
    wrong = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": "not-the-password-1A!"})
    assert wrong.status_code == 401
    challenged = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert challenged.status_code == 200, challenged.text
    assert "mfa_token" in challenged.json(), "the sign-in waits for the code"
    assert await _last_signed_in_at(user_id) == _CONFIRMED, "no session was issued, so the time stays"

    completed = await client.post("/auth/2fa/verify", json={"mfa_token": challenged.json()["mfa_token"], "code": _fresh_totp_code(secret)})
    assert completed.status_code == 200, completed.text
    assert await _last_signed_in_at(user_id) == _SIGNED_IN, "giving the code issues the session, which counts"


async def test_a_refused_renewal_of_a_profile_being_deleted_leaves_the_time(client, freeze_now):
    """A profile marked for deletion can't renew, and the refusal is not recorded as use"""
    freeze_now(sessions, _CONFIRMED)
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    async with TestSession() as session:
        await session.execute(update(User).where(User.id == user_id).values(deletion_requested_at=_CONFIRMED))
        await session.commit()

    freeze_now(sessions, _RENEWED)
    renewal = await _refresh_session(client, signup.cookies["refresh_token"])

    assert renewal.status_code == 401
    assert await _last_signed_in_at(user_id) == _CONFIRMED
