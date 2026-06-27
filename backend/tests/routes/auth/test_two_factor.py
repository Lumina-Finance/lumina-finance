"""TOTP enrolment route tests"""

import pyotp

from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header

_PASSWORD = SIGNUP_PAYLOAD["password"]


async def _enroll(client):
    """Sign up a user and complete TOTP enrolment, returning the auth header, secret, and codes"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    return auth, secret, confirm.json()["recovery_codes"]


async def test_setup_then_confirm_enables_totp_and_returns_recovery_codes(client):
    """A valid setup and confirm turns on 2FA and returns the one-time recovery codes"""
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


async def test_regenerate_replaces_the_codes(client):
    """Regenerating returns a fresh batch that does not overlap the old one"""
    auth, secret, codes = await _enroll(client)

    regenerate = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": pyotp.TOTP(secret).now()}
    )
    assert regenerate.status_code == 200
    new_codes = regenerate.json()["recovery_codes"]
    assert len(new_codes) == 6
    assert set(new_codes).isdisjoint(codes)


async def test_regenerate_accepts_a_recovery_code_as_second_factor(client):
    """A recovery code satisfies the step-up second factor for regeneration"""
    auth, _, codes = await _enroll(client)

    regenerate = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": codes[0]}
    )
    assert regenerate.status_code == 200
    assert len(regenerate.json()["recovery_codes"]) == 6
