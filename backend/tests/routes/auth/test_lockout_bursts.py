"""Simultaneous sign-in attempts are checked only up to the lockout limit, whatever their timing"""

import importlib
import uuid

import pytest
from sqlalchemy import select

from app.models.user import User
from app.routes.auth import token_helpers
from app.services.auth import step_up as step_up_service
from app.services.auth.mfa_challenge import MFA_PURPOSE_LOGIN, MFA_PURPOSE_PASSWORD_RESET, issue_mfa_challenge
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    HeldCheck,
    _create_user,
    _enroll,
    _fresh_totp_code,
    _get_auth_header,
    _get_login_lockout,
    _seed_reset_token,
    finish_burst,
    fire_burst,
    start_burst,
)

# The services package exports the login function under the module's own name
login_service = importlib.import_module("app.services.auth.login")

_PASSWORD = SIGNUP_PAYLOAD["password"]
_EMAIL = SIGNUP_PAYLOAD["email"]
_ATTEMPTS_BEFORE_LOCK = 5
_BURST_SIZE = 20
_WRONG_CODE = "000000"
_NEW_PASSWORD = "NewSecurePass123!"
_UNKNOWN_EMAIL = "nobody@example.com"


def _outcomes(responses) -> list[tuple[int, str]]:
    """Return the status and detail of each response, sorted so a burst compares whatever order it finished in"""
    return sorted((response.status_code, response.json()["detail"]) for response in responses)


def _locked_after_five(refusal: tuple[int, str]) -> list[tuple[int, str]]:
    """Return the outcomes of a burst of 20 wrong attempts: five refusals as checked, the rest locked out"""
    return sorted([refusal] * _ATTEMPTS_BEFORE_LOCK + [(423, "Account temporarily locked")] * (_BURST_SIZE - _ATTEMPTS_BEFORE_LOCK))


async def _only_user_id() -> uuid.UUID:
    """Return the id of the one account the test signed up"""
    async with TestSession() as db:
        return await db.scalar(select(User.id))


async def _challenges(purpose: str) -> list[str]:
    """Issue one second-factor challenge per request of a burst, each as a separate sign-in would"""
    user_id = await _only_user_id()
    tokens = []
    for _ in range(_BURST_SIZE):
        async with TestSession() as db:
            tokens.append(await issue_mfa_challenge(db, user_id, purpose))
    return tokens


@pytest.mark.parametrize(("email", "primitive"), [(_EMAIL, "is_password_valid"), (_UNKNOWN_EMAIL, "hash_dummy_password_for_timing")])
async def test_login_burst_of_wrong_passwords_checks_five_and_locks_the_rest(client, monkeypatch, email, primitive):
    """Twenty wrong passwords sent at once cost five hashes whether or not the email has an account, and the other fifteen find it locked"""
    await _create_user(client)
    held = HeldCheck(getattr(login_service, primitive))
    monkeypatch.setattr(login_service, primitive, held)

    responses = await fire_burst(
        [client.post("/auth/login", json={"email": email, "password": "wrong-password"}) for _ in range(_BURST_SIZE)], held
    )

    assert _outcomes(responses) == _locked_after_five((401, "Invalid credentials"))
    assert held.calls == _ATTEMPTS_BEFORE_LOCK
    assert (await _get_login_lockout(email)).failed_attempt_count == _ATTEMPTS_BEFORE_LOCK


async def test_login_with_the_right_password_after_a_held_burst_is_locked_out(client, monkeypatch):
    """With nineteen wrong passwords still being checked, the right one is refused as locked and gets no tokens"""
    await _create_user(client)
    held = HeldCheck(login_service.is_password_valid, holds=lambda password, _hash: password != _PASSWORD)
    monkeypatch.setattr(login_service, "is_password_valid", held)

    parked = await start_burst([client.post("/auth/login", json={"email": _EMAIL, "password": "wrong-password"}) for _ in range(19)], held)
    right = await client.post("/auth/login", json={"email": _EMAIL, "password": _PASSWORD})
    await finish_burst(parked, held)

    assert (right.status_code, right.json()) == (423, {"detail": "Account temporarily locked"})


@pytest.mark.parametrize(
    ("path", "purpose"),
    [("/auth/2fa/verify", MFA_PURPOSE_LOGIN), ("/auth/password/reset/verify", MFA_PURPOSE_PASSWORD_RESET)],
    ids=["sign-in", "password-reset"],
)
async def test_second_factor_burst_of_wrong_codes_checks_five_and_locks_the_rest(client, monkeypatch, path, purpose):
    """Twenty wrong codes, each on its own challenge, sent at once run five checks at sign-in and at password reset alike"""
    await _enroll(client)
    tokens = await _challenges(purpose)
    reset_token = await _seed_reset_token(await _only_user_id()) if purpose == MFA_PURPOSE_PASSWORD_RESET else None
    held = HeldCheck(token_helpers.verify_login_second_factor)
    monkeypatch.setattr(token_helpers, "verify_login_second_factor", held)

    def body(mfa_token: str) -> dict:
        """Return the request body of the route under test"""
        if purpose == MFA_PURPOSE_LOGIN:
            return {"mfa_token": mfa_token, "code": _WRONG_CODE}
        return {"token": reset_token, "mfa_token": mfa_token, "code": _WRONG_CODE, "new_password": _NEW_PASSWORD}

    responses = await fire_burst([client.post(path, json=body(token)) for token in tokens], held)

    assert _outcomes(responses) == _locked_after_five((401, "Invalid code"))
    assert held.calls == _ATTEMPTS_BEFORE_LOCK
    assert (await _get_login_lockout(_EMAIL)).failed_attempt_count == _ATTEMPTS_BEFORE_LOCK


async def test_second_factor_with_the_right_code_after_a_held_burst_is_locked_out(client, monkeypatch):
    """With nineteen wrong codes still being checked, the right one is refused as locked and gets no tokens"""
    _, secret, _ = await _enroll(client)
    tokens = await _challenges(MFA_PURPOSE_LOGIN)
    right_code = _fresh_totp_code(secret)
    held = HeldCheck(token_helpers.verify_login_second_factor, holds=lambda _db, _user_id, code: code != right_code)
    monkeypatch.setattr(token_helpers, "verify_login_second_factor", held)

    parked = await start_burst([client.post("/auth/2fa/verify", json={"mfa_token": token, "code": _WRONG_CODE}) for token in tokens[:19]], held)
    right = await client.post("/auth/2fa/verify", json={"mfa_token": tokens[19], "code": right_code})
    await finish_burst(parked, held)

    assert (right.status_code, right.json()) == (423, {"detail": "Account temporarily locked"})


async def test_step_up_burst_of_wrong_codes_checks_five_and_reports_each_remaining_allowance(client, monkeypatch):
    """Twenty wrong step-up codes sent at once run five code checks, the five answers counting down from four"""
    auth, _, _ = await _enroll(client)
    held = HeldCheck(step_up_service.is_user_totp_code_valid)
    monkeypatch.setattr(step_up_service, "is_user_totp_code_valid", held)

    responses = await fire_burst(
        [client.post("/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": _WRONG_CODE}) for _ in range(_BURST_SIZE)],
        held,
    )

    assert _outcomes(responses) == _locked_after_five((401, "Invalid two-factor code"))
    assert held.calls == _ATTEMPTS_BEFORE_LOCK
    counted = [response.headers["x-auth-attempts-remaining"] for response in responses if response.status_code == 401]
    assert sorted(counted) == ["0", "1", "2", "3", "4"]


async def test_step_up_burst_of_wrong_passwords_with_a_right_code_checks_five_and_locks_the_rest(client, monkeypatch):
    """Twenty wrong passwords sent with a right code at once run five password checks, since each attempt covers both"""
    auth, secret, _ = await _enroll(client)
    held = HeldCheck(step_up_service.is_password_valid)
    monkeypatch.setattr(step_up_service, "is_password_valid", held)
    code = _fresh_totp_code(secret)

    responses = await fire_burst(
        [client.post("/auth/2fa/recovery-codes", headers=auth, json={"password": "wrong-password", "code": code}) for _ in range(_BURST_SIZE)],
        held,
    )

    assert _outcomes(responses) == _locked_after_five((401, "Invalid credentials"))
    assert held.calls == _ATTEMPTS_BEFORE_LOCK


async def test_step_up_without_a_factor_burst_of_wrong_passwords_checks_five_and_locks_the_rest(client, monkeypatch):
    """Twenty wrong passwords at the password-only step-up sent at once run five hashes"""
    auth = _get_auth_header(await _create_user(client))
    held = HeldCheck(step_up_service.is_password_valid)
    monkeypatch.setattr(step_up_service, "is_password_valid", held)

    responses = await fire_burst(
        [client.post("/auth/2fa/setup", headers=auth, json={"step_up": {"password": "wrong-password"}}) for _ in range(_BURST_SIZE)], held
    )

    assert _outcomes(responses) == _locked_after_five((401, "Invalid credentials"))
    assert held.calls == _ATTEMPTS_BEFORE_LOCK
