"""Signing out of every other device, confirmed with the password and any current second factor"""

from sqlalchemy import update

from app.models.auth import TotpCredential
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _assert_other_sessions_ended,
    _assert_other_sessions_kept,
    _assert_session_works,
    _create_user,
    _enroll,
    _fresh_totp_code,
    _get_auth_header,
    _get_step_up_lockout,
    _sign_in_again,
    sign_up_confirmed,
)

_PASSWORD = SIGNUP_PAYLOAD["password"]
_END_OTHERS = "/auth/sessions/end-others"


async def test_end_others_with_password_signs_out_other_sessions(client):
    """The password signs every other device out, keeps the one that asked and leaves another user's session alone"""
    signup = await _create_user(client)
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)
    bystander_signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "bystander@example.com"})
    bystander = (_get_auth_header(bystander_signup), bystander_signup.cookies["refresh_token"])
    await _assert_session_works(client, caller)
    await _assert_session_works(client, other)
    await _assert_session_works(client, bystander)

    response = await client.post(_END_OTHERS, headers=caller[0], json={"password": _PASSWORD})
    assert response.status_code == 204

    await _assert_session_works(client, bystander)
    await _assert_other_sessions_ended(client, caller, other)


async def test_end_others_without_password_refused_keeps_other_sessions(client):
    """No step-up, or a wrong password that counts toward the lockout, signs nobody out"""
    signup = await _create_user(client)
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)

    missing = await client.post(_END_OTHERS, headers=caller[0])
    assert missing.status_code == 401
    assert missing.json()["detail"] == "Reauthentication required"

    wrong = await client.post(_END_OTHERS, headers=caller[0], json={"password": "WrongPassword123!"})
    assert wrong.status_code == 401
    assert wrong.json()["detail"] == "Invalid credentials"
    assert (await _get_step_up_lockout(caller[0])).failed_attempt_count == 1

    await _assert_other_sessions_kept(client, caller, other)


async def test_end_others_with_second_factor_needs_current_code(client):
    """An account with an authenticator is refused on the password alone and signs out with a code"""
    auth, secret, _ = await _enroll(client)
    caller = (auth, client.cookies["refresh_token"])

    # The account challenges at sign-in now, so the other device signs in with a code
    challenge = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    verify = await client.post("/auth/2fa/verify", json={"mfa_token": challenge.json()["mfa_token"], "code": _fresh_totp_code(secret)})
    assert verify.status_code == 200
    other = (_get_auth_header(verify), verify.cookies["refresh_token"])
    await _assert_session_works(client, caller)
    await _assert_session_works(client, other)

    password_only = await client.post(_END_OTHERS, headers=caller[0], json={"password": _PASSWORD})
    assert password_only.status_code == 400
    assert password_only.json()["detail"] == "A second factor is required"
    await _assert_session_works(client, other)

    # The sign-in spent the code's step, so free it for the step-up
    async with TestSession() as db:
        await db.execute(update(TotpCredential).values(last_used_step=None))
        await db.commit()
    response = await client.post(_END_OTHERS, headers=caller[0], json={"password": _PASSWORD, "code": _fresh_totp_code(secret)})
    assert response.status_code == 204

    await _assert_other_sessions_ended(client, caller, other)
