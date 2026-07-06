"""Password reset request and consume route tests"""

import uuid

import pyotp
from sqlalchemy import func, select

from app.models.auth import PasswordResetToken
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _fresh_totp_code, _get_auth_header, _seed_reset_token

_NEW_PASSWORD = "NewSecurePass123!"


async def _enroll_totp(client):
    """Sign up the default user and enrol TOTP, returning the signup response, secret, and recovery codes"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    step_up = {"step_up": {"password": SIGNUP_PAYLOAD["password"]}}
    secret = (await client.post("/auth/2fa/setup", headers=auth, json=step_up)).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    return signup, secret, confirm.json()["recovery_codes"]


async def _begin_reset_with_factor(client, user_id):
    """Seed a reset token and request the reset, returning the raw token and the challenge body"""
    raw_token = await _seed_reset_token(user_id)
    begin = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert begin.status_code == 200
    return raw_token, begin.json()


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


async def test_reset_with_second_factor_returns_challenge_and_keeps_token(client):
    """An account with a factor gets a challenge instead of a reset, and the token stays unused"""
    signup, _, _ = await _enroll_totp(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])

    _, challenge = await _begin_reset_with_factor(client, user_id)

    assert challenge["mfa_required"] is True
    assert challenge["totp_enabled"] is True
    assert challenge["mfa_token"]

    rows = await _reset_tokens_for(user_id)
    assert rows[0].used_at is None


async def test_reset_verify_with_totp_sets_password_and_keeps_factors(client):
    """A valid authenticator code completes the reset and the factor survives"""
    signup, secret, _ = await _enroll_totp(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token, challenge = await _begin_reset_with_factor(client, user_id)

    verify = await client.post(
        "/auth/password/reset/verify",
        json={
            "token": raw_token,
            "new_password": _NEW_PASSWORD,
            "mfa_token": challenge["mfa_token"],
            "code": _fresh_totp_code(secret),
        },
    )
    assert verify.status_code == 204
    assert (await _reset_tokens_for(user_id))[0].used_at is not None

    # The new password authenticates and still lands on the second-factor step
    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _NEW_PASSWORD})
    assert login.status_code == 200
    assert login.json()["mfa_required"] is True
    assert login.json()["totp_enabled"] is True


async def test_reset_verify_with_recovery_code_wipes_factors_and_grants_restricted_session(client):
    """A recovery code completes the reset, wipes every factor, and returns the re-enrolment session"""
    signup, _, recovery_codes = await _enroll_totp(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token, challenge = await _begin_reset_with_factor(client, user_id)

    verify = await client.post(
        "/auth/password/reset/verify",
        json={
            "token": raw_token,
            "new_password": _NEW_PASSWORD,
            "mfa_token": challenge["mfa_token"],
            "code": recovery_codes[0],
        },
    )
    assert verify.status_code == 200
    assert verify.json()["access_token"]

    # The wiped account forces re-enrolment at the next login, with only a recovery code usable
    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _NEW_PASSWORD})
    assert login.status_code == 200
    assert login.json()["mfa_required"] is True
    assert login.json()["recovery_only"] is True


async def test_reset_verify_wrong_code_burns_the_challenge(client):
    """A wrong code spends the single-use challenge, so even the right code then fails"""
    signup, secret, _ = await _enroll_totp(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token, challenge = await _begin_reset_with_factor(client, user_id)

    payload = {
        "token": raw_token,
        "new_password": _NEW_PASSWORD,
        "mfa_token": challenge["mfa_token"],
        "code": "000000",
    }
    assert (await client.post("/auth/password/reset/verify", json=payload)).status_code == 401

    payload["code"] = _fresh_totp_code(secret)
    assert (await client.post("/auth/password/reset/verify", json=payload)).status_code == 401
    assert (await _reset_tokens_for(user_id))[0].used_at is None


async def test_reset_verify_rejects_a_login_challenge(client):
    """A challenge issued by login cannot complete a reset, even with a valid code"""
    signup, secret, _ = await _enroll_totp(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token = await _seed_reset_token(user_id)

    login = await client.post(
        "/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]}
    )
    login_mfa_token = login.json()["mfa_token"]

    verify = await client.post(
        "/auth/password/reset/verify",
        json={
            "token": raw_token,
            "new_password": _NEW_PASSWORD,
            "mfa_token": login_mfa_token,
            "code": _fresh_totp_code(secret),
        },
    )
    assert verify.status_code == 401
    assert (await _reset_tokens_for(user_id))[0].used_at is None


async def test_reset_verify_rejects_a_challenge_for_another_user(client):
    """A verified challenge for one account cannot redeem a reset token issued to another"""
    signup, secret, _ = await _enroll_totp(client)
    factor_user_id = uuid.UUID(signup.json()["user"]["id"])
    _, challenge = await _begin_reset_with_factor(client, factor_user_id)

    other_signup = await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "email": "other@example.com"})
    other_user_id = uuid.UUID(other_signup.json()["user"]["id"])
    other_token = await _seed_reset_token(other_user_id, raw_token="reset-token-other")

    verify = await client.post(
        "/auth/password/reset/verify",
        json={
            "token": other_token,
            "new_password": _NEW_PASSWORD,
            "mfa_token": challenge["mfa_token"],
            "code": _fresh_totp_code(secret),
        },
    )
    assert verify.status_code == 400
    assert (await _reset_tokens_for(other_user_id))[0].used_at is None


async def test_reset_verify_locked_account_is_rejected(client):
    """A locked account cannot verify the reset factor, keeping code guessing capped by the lockout"""
    signup, secret, _ = await _enroll_totp(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    raw_token, challenge = await _begin_reset_with_factor(client, user_id)

    # Five wrong passwords trip the shared lockout
    for _ in range(5):
        await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": "WrongPassword123!"})

    verify = await client.post(
        "/auth/password/reset/verify",
        json={
            "token": raw_token,
            "new_password": _NEW_PASSWORD,
            "mfa_token": challenge["mfa_token"],
            "code": _fresh_totp_code(secret),
        },
    )
    assert verify.status_code == 423
