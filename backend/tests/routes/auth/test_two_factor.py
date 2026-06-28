"""TOTP enrolment route tests"""

import uuid

import pyotp

from app.services.auth.mfa_challenge import issue_mfa_challenge
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header

_PASSWORD = SIGNUP_PAYLOAD["password"]


async def _issue_challenge(user_id):
    """Issue an MFA challenge token directly, standing in for the login step that emits it"""
    async with TestSession() as db:
        return await issue_mfa_challenge(db, uuid.UUID(user_id))


async def _enroll_with_id(client):
    """Enrol a user in TOTP and return the auth header, secret, and user id"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    return auth, secret, signup.json()["user"]["id"]


async def _enroll(client):
    """Sign up a user and complete TOTP enrolment, returning the auth header, secret, and codes"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    return auth, secret, confirm.json()["recovery_codes"]


async def test_status_reflects_enrolment(client):
    """The status endpoint reports false before enrolment and true after"""
    auth = _get_auth_header(await _create_user(client))

    before = await client.get("/auth/2fa/status", headers=auth)
    assert before.status_code == 200
    assert before.json()["totp_enabled"] is False

    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    after = await client.get("/auth/2fa/status", headers=auth)
    assert after.json()["totp_enabled"] is True


async def test_confirm_returns_recovery_codes_but_leaves_two_factor_pending(client):
    """Confirm returns the one-time recovery codes yet two-factor stays off until completion"""
    auth = _get_auth_header(await _create_user(client))

    setup = await client.post("/auth/2fa/setup", headers=auth)
    assert setup.status_code == 200
    body = setup.json()
    assert body["provisioning_uri"].startswith("otpauth://totp/")

    code = pyotp.TOTP(body["secret"]).now()
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": code})
    assert confirm.status_code == 200

    codes = confirm.json()["recovery_codes"]
    assert len(codes) == 6
    assert all(code.count("-") == 4 for code in codes)

    # Closing the recovery code screen without completing must leave two-factor un-enrolled
    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is False


async def test_complete_turns_on_two_factor_after_confirm(client):
    """Completing enrolment after confirm turns two-factor on"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})

    complete = await client.post("/auth/2fa/complete", headers=auth)
    assert complete.status_code == 204

    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is True


async def test_complete_without_confirm_is_rejected(client):
    """Completing before a code is confirmed is refused so 2FA never enables around an unverified secret"""
    auth = _get_auth_header(await _create_user(client))
    await client.post("/auth/2fa/setup", headers=auth)

    complete = await client.post("/auth/2fa/complete", headers=auth)
    assert complete.status_code == 400

    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is False


async def test_restarting_setup_discards_staged_codes(client):
    """Restarting setup clears a stale staged batch, so completion still needs a fresh confirm"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})

    # Restart setup without confirming the new secret, then try to finish off the stale staged batch
    await client.post("/auth/2fa/setup", headers=auth)
    complete = await client.post("/auth/2fa/complete", headers=auth)
    assert complete.status_code == 400

    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is False


async def test_confirm_rejects_a_wrong_code(client):
    """Confirming with an invalid code returns 400 and does not enable 2FA"""
    auth = _get_auth_header(await _create_user(client))
    await client.post("/auth/2fa/setup", headers=auth)

    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": "000000"})
    assert confirm.status_code == 400


async def test_setup_conflicts_once_confirmed(client):
    """Re-running setup over confirmed 2FA is refused so a live factor is never replaced silently"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    again = await client.post("/auth/2fa/setup", headers=auth)
    assert again.status_code == 409


async def test_disable_turns_off_two_factor(client):
    """A correct password and code disables 2FA, after which setup is allowed again"""
    auth, secret, _ = await _enroll(client)

    disable = await client.post(
        "/auth/2fa/disable", headers=auth, json={"password": _PASSWORD, "code": pyotp.TOTP(secret).now()}
    )
    assert disable.status_code == 204
    assert (await client.post("/auth/2fa/setup", headers=auth)).status_code == 200


async def test_disable_rejects_a_wrong_password(client):
    """Disable refuses a wrong password even with a valid code"""
    auth, secret, _ = await _enroll(client)

    disable = await client.post(
        "/auth/2fa/disable", headers=auth, json={"password": "WrongPass123!", "code": pyotp.TOTP(secret).now()}
    )
    assert disable.status_code == 401


async def test_disable_requires_two_factor_enabled(client):
    """Disabling when 2FA is off returns a clear 400 rather than an auth error"""
    auth = _get_auth_header(await _create_user(client))

    disable = await client.post("/auth/2fa/disable", headers=auth, json={"password": _PASSWORD, "code": "000000"})
    assert disable.status_code == 400


async def test_regenerate_then_confirm_swaps_the_codes(client):
    """Confirming a regeneration activates the new batch and retires the old one"""
    auth, secret, old_codes = await _enroll(client)

    regenerate = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": pyotp.TOTP(secret).now()}
    )
    assert regenerate.status_code == 200
    new_codes = regenerate.json()["recovery_codes"]
    assert len(new_codes) == 6
    assert set(new_codes).isdisjoint(old_codes)

    confirm = await client.post("/auth/2fa/recovery-codes/confirm", headers=auth)
    assert confirm.status_code == 204

    assert (await _login_with_code(client, old_codes[0])).status_code == 401
    assert (await _login_with_code(client, new_codes[0])).status_code == 200


async def test_abandoned_regenerate_keeps_old_codes(client):
    """A staged regeneration that is never confirmed leaves the existing codes working"""
    auth, secret, old_codes = await _enroll(client)

    regenerate = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": pyotp.TOTP(secret).now()}
    )
    assert regenerate.status_code == 200

    # No confirm, so an existing code still signs in
    assert (await _login_with_code(client, old_codes[0])).status_code == 200


async def test_confirm_recovery_codes_requires_a_staged_batch(client):
    """Confirming with nothing staged is refused so it cannot wipe the active codes"""
    auth, _, _ = await _enroll(client)

    confirm = await client.post("/auth/2fa/recovery-codes/confirm", headers=auth)
    assert confirm.status_code == 400


async def test_regenerate_rejects_a_recovery_code_as_second_factor(client):
    """Step-up takes only the authenticator, so a recovery code cannot rotate the recovery codes"""
    auth, _, codes = await _enroll(client)

    regenerate = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": codes[0]}
    )
    assert regenerate.status_code == 401

    # The rejected code is not consumed, so it still works at login
    assert (await _login_with_code(client, codes[0])).status_code == 200


async def test_verify_completes_login_with_a_valid_code(client):
    """A valid challenge token and code returns an access token"""
    _, secret, user_id = await _enroll_with_id(client)
    mfa_token = await _issue_challenge(user_id)

    verify = await client.post("/auth/2fa/verify", json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now()})
    assert verify.status_code == 200
    assert verify.json()["access_token"]


async def test_verify_burns_the_challenge_on_a_wrong_code(client):
    """A wrong code spends the single-use challenge, so even the right code then fails"""
    _, secret, user_id = await _enroll_with_id(client)
    mfa_token = await _issue_challenge(user_id)

    wrong = await client.post("/auth/2fa/verify", json={"mfa_token": mfa_token, "code": "000000"})
    assert wrong.status_code == 401

    retry = await client.post("/auth/2fa/verify", json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now()})
    assert retry.status_code == 401


async def test_verify_rejects_a_forged_token(client):
    """A token that is not a valid challenge JWT is rejected"""
    verify = await client.post("/auth/2fa/verify", json={"mfa_token": "not.a.jwt", "code": "000000"})
    assert verify.status_code == 401


async def test_login_returns_a_challenge_when_two_factor_is_enabled(client):
    """An enrolled user logs in to a challenge, then verifies it for tokens"""
    _, secret, _ = await _enroll_with_id(client)

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert login.status_code == 200
    body = login.json()
    assert body["mfa_required"] is True
    assert body["recovery_only"] is False
    assert "access_token" not in body

    verify = await client.post("/auth/2fa/verify", json={"mfa_token": body["mfa_token"], "code": pyotp.TOTP(secret).now()})
    assert verify.status_code == 200
    assert verify.json()["access_token"]


async def test_login_returns_tokens_without_two_factor(client):
    """A user with no second factor logs straight in to tokens"""
    await _create_user(client)

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert login.status_code == 200
    body = login.json()
    assert body["access_token"]
    assert "mfa_required" not in body


async def _login_with_code(client, code):
    """Sign in past the password step and submit a second-factor code, returning the verify response"""
    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    return await client.post("/auth/2fa/verify", json={"mfa_token": login.json()["mfa_token"], "code": code})


async def test_recovery_code_login_forces_reenrollment(client):
    """Signing in with a recovery code logs in but flags the session for forced re-enrolment"""
    _, _, codes = await _enroll(client)

    verify = await _login_with_code(client, codes[0])
    assert verify.status_code == 200
    body = verify.json()
    assert body["access_token"]
    assert body["user"]["totp_reenrollment_required"] is True


async def test_restricted_session_is_blocked_from_normal_routes(client):
    """A recovery-code session cannot reach a normal protected route until it re-enrols"""
    _, _, codes = await _enroll(client)
    token = (await _login_with_code(client, codes[0])).json()["access_token"]
    restricted = {"Authorization": f"Bearer {token}"}

    blocked = await client.get("/auth/2fa/status", headers=restricted)
    assert blocked.status_code == 403


async def test_restricted_session_re_enrols_with_fresh_codes(client):
    """A recovery-code session re-enrols through setup, confirm, and complete, getting a fresh batch"""
    _, _, old_codes = await _enroll(client)
    token = (await _login_with_code(client, old_codes[0])).json()["access_token"]
    restricted = {"Authorization": f"Bearer {token}"}

    secret = (await client.post("/auth/2fa/setup", headers=restricted)).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=restricted, json={"code": pyotp.TOTP(secret).now()})
    assert confirm.status_code == 200
    new_codes = confirm.json()["recovery_codes"]
    assert set(new_codes).isdisjoint(old_codes)

    complete = await client.post("/auth/2fa/complete", headers=restricted)
    assert complete.status_code == 204

    unlocked = await client.get("/auth/2fa/status", headers=restricted)
    assert unlocked.status_code == 200
    assert unlocked.json()["totp_enabled"] is True

    # The old batch is replaced, so a leftover old code no longer signs in
    assert (await _login_with_code(client, old_codes[1])).status_code == 401


async def test_old_recovery_codes_survive_an_abandoned_reenrol(client):
    """Confirming a re-enrol stages new codes, but an old code keeps working until completion"""
    _, _, old_codes = await _enroll(client)
    token = (await _login_with_code(client, old_codes[0])).json()["access_token"]
    restricted = {"Authorization": f"Bearer {token}"}

    # Confirm a fresh authenticator but abandon before completing
    secret = (await client.post("/auth/2fa/setup", headers=restricted)).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=restricted, json={"code": pyotp.TOTP(secret).now()})
    assert confirm.status_code == 200

    # A remaining old code still signs in, proving the staged batch did not replace it
    again = await _login_with_code(client, old_codes[1])
    assert again.status_code == 200
    assert again.json()["user"]["totp_reenrollment_required"] is True


async def test_recovery_codes_are_single_use_and_deplete(client):
    """Each recovery code logs in once, and a spent code is refused while others still work"""
    _, _, codes = await _enroll(client)

    first = await _login_with_code(client, codes[0])
    assert first.status_code == 200

    reused = await _login_with_code(client, codes[0])
    assert reused.status_code == 401

    another = await _login_with_code(client, codes[1])
    assert another.status_code == 200
    assert another.json()["user"]["totp_reenrollment_required"] is True


async def test_login_after_recovery_reports_recovery_only(client):
    """Once the authenticator is revoked, the next login challenge signals only a recovery code works"""
    _, _, codes = await _enroll(client)
    await _login_with_code(client, codes[0])

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert login.status_code == 200
    body = login.json()
    assert body["mfa_required"] is True
    assert body["recovery_only"] is True
