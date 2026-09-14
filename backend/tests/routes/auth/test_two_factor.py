"""TOTP enrolment route tests"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pyotp
import pytest
from sqlalchemy import func, select, text, update

from app.models.auth import RecoveryCode, TotpCredential
from app.routes.auth.router import login_route
from app.services.auth import two_factor, webauthn
from app.services.auth.mfa_challenge import MFA_PURPOSE_LOGIN, MFA_PURPOSE_PASSWORD_RESET, issue_mfa_challenge
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _fresh_totp_code, _get_auth_header

_PASSWORD = SIGNUP_PAYLOAD["password"]

# Adding the first factor steps up with the password alone, since there is no factor to present yet
_STEP_UP = {"password": _PASSWORD}


async def _issue_challenge(user_id):
    """Issue an MFA challenge token directly, standing in for the login step that emits it"""
    async with TestSession() as db:
        return await issue_mfa_challenge(db, uuid.UUID(user_id), MFA_PURPOSE_LOGIN)


async def _enroll_with_id(client):
    """Enrol a user in TOTP and return the auth header, secret, and user id"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    return auth, secret, signup.json()["user"]["id"]


async def _enroll(client):
    """Sign up a user and complete TOTP enrolment, returning the auth header, secret, and codes"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    return auth, secret, confirm.json()["recovery_codes"]


async def _seed_active_recovery_code(user_id: str) -> None:
    """Insert one active recovery code, standing in for a batch issued by another second factor"""
    async with TestSession() as db:
        db.add(RecoveryCode(user_id=uuid.UUID(user_id), code_hash="seeded-active-code", pending=False))
        await db.commit()


async def _stage_totp(client, signup=None):
    """Verify a pending authenticator and return its session, secret and owner without completing"""
    if signup is None:
        signup = await _create_user(client)
    auth = _get_auth_header(signup)
    setup = await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    confirmed = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    assert confirmed.status_code == 200
    return auth, secret, uuid.UUID(signup.json()["user"]["id"])


async def _age_totp_staging(user_id, created_at):
    """Set the persisted age of a user's pending authenticator and recovery batch"""
    async with TestSession() as db:
        await db.execute(update(TotpCredential).where(TotpCredential.user_id == user_id).values(created_at=created_at))
        await db.execute(
            update(RecoveryCode)
            .where(RecoveryCode.user_id == user_id, RecoveryCode.pending.is_(True))
            .values(created_at=created_at)
        )
        await db.commit()


def _freeze_staging_cleanup(monkeypatch, now, lifetime=1800):
    """Fix the staging clock and lifetime without changing route execution"""
    for service in (webauthn, two_factor):
        monkeypatch.setattr(service, "datetime", SimpleNamespace(now=lambda _tz: now), raising=False)
        monkeypatch.setattr(service, "TWO_FACTOR_STAGING_EXPIRE_SECONDS", lifetime, raising=False)


@pytest.mark.parametrize(
    ("age", "lifetime", "survives"),
    [(1801, 1800, False), (1800, 1800, True), (1799, 1800, True), (61, 60, False)],
)
async def test_login_prunes_only_expired_pending_totp(client, monkeypatch, age, lifetime, survives):
    """The login sweep honours the configured strict cutoff for authenticator and recovery staging"""
    auth, secret, user_id = await _stage_totp(client)
    now = datetime.now(UTC)
    await _age_totp_staging(user_id, now - timedelta(seconds=age))
    _freeze_staging_cleanup(monkeypatch, now, lifetime)

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert login.status_code == 200

    async with TestSession() as db:
        credential = await db.get(TotpCredential, user_id)
        codes = (await db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == user_id))).all()
    assert (credential is not None) is survives
    assert len(codes) == (10 if survives else 0)

    if survives:
        assert credential.confirmed_at is None
        assert (await client.post("/auth/2fa/complete", headers=auth)).status_code == 204
    else:
        confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": _fresh_totp_code(secret)})
        assert confirm.status_code == 400
        assert (await client.post("/auth/2fa/complete", headers=auth)).status_code == 400


async def test_login_preserves_confirmed_totp_and_other_users_staging(client, monkeypatch):
    """Cleanup leaves active factors and codes intact and only touches the logging-in user's staging"""
    auth, _, user_id = await _stage_totp(client)
    assert (await client.post("/auth/2fa/complete", headers=auth)).status_code == 204
    second = await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "email": "other@example.com"})
    assert second.status_code == 201
    _, _, other_id = await _stage_totp(client, second)
    now = datetime.now(UTC)
    old = now - timedelta(seconds=1801)
    await _age_totp_staging(user_id, old)
    await _age_totp_staging(other_id, old)
    async with TestSession() as db:
        await db.execute(update(RecoveryCode).where(RecoveryCode.user_id == user_id).values(created_at=old))
        await db.commit()
    _freeze_staging_cleanup(monkeypatch, now)

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert login.status_code == 200
    assert login.json()["mfa_required"] is True
    assert login.json()["totp_enabled"] is True
    async with TestSession() as db:
        assert (await db.get(TotpCredential, user_id)).confirmed_at is not None
        assert (await db.get(TotpCredential, other_id)).confirmed_at is None
        active_codes = (await db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == user_id))).all()
        other_codes = (await db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == other_id))).all()
    assert len(active_codes) == 10
    assert all(not row.pending for row in active_codes)
    assert len(other_codes) == 10
    assert all(row.pending for row in other_codes)


async def test_restarting_totp_setup_refreshes_its_staging_lifetime(client, monkeypatch):
    """A restarted setup receives a fresh lifetime and survives the next login sweep"""
    auth, _, user_id = await _stage_totp(client)
    now = datetime.now(UTC)
    await _age_totp_staging(user_id, now - timedelta(seconds=1801))
    _freeze_staging_cleanup(monkeypatch, now)

    setup = await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})
    assert setup.status_code == 200
    async with TestSession() as db:
        assert (await db.get(TotpCredential, user_id)).created_at >= now

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert login.status_code == 200
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(setup.json()["secret"]).now()})
    assert confirm.status_code == 200
    assert (await client.post("/auth/2fa/complete", headers=auth)).status_code == 204


async def _wait_for_cleanup_overlap(task, blocker_pid, blocked_pid):
    """Observe the competing request finish or actually wait on the held database transaction"""
    async with TestSession() as observer:
        while not task.done():
            blockers = await observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": blocked_pid})
            if blocker_pid in blockers:
                return
            await asyncio.sleep(0.01)


@pytest.mark.parametrize("action", ["confirm", "complete"])
async def test_totp_requests_reject_setup_removed_by_concurrent_login(client, monkeypatch, action):
    """Confirmation observes a concurrent cleanup as expired setup instead of updating a deleted row"""
    auth, secret, user_id = await _stage_totp(client)
    now = datetime.now(UTC)
    await _age_totp_staging(user_id, now - timedelta(seconds=1801))
    _freeze_staging_cleanup(monkeypatch, now)
    cleanup_paused = asyncio.Event()
    action_started = asyncio.Event()
    release_cleanup = asyncio.Event()
    pids = {}
    route_globals = login_route.__globals__
    original_sweep = route_globals["prune_stale_factor_staging"]
    action_name = f"{action}_totp_enrollment"
    original_action = route_globals[action_name]

    async def pause_cleanup(db, owner_id):
        """Hold the real deletion uncommitted while another request reads its old visible state"""
        pids["cleanup"] = await db.scalar(select(func.pg_backend_pid()))
        await original_sweep(db, owner_id)
        cleanup_paused.set()
        await release_cleanup.wait()

    async def observe_action(db, *args):
        """Identify the actual confirmation transaction without changing its behaviour"""
        pids["action"] = await db.scalar(select(func.pg_backend_pid()))
        action_started.set()
        return await original_action(db, *args)

    monkeypatch.setitem(route_globals, "prune_stale_factor_staging", pause_cleanup)
    monkeypatch.setitem(route_globals, action_name, observe_action)
    tasks = []
    try:
        async with asyncio.timeout(5):
            login = asyncio.create_task(client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD}))
            tasks.append(login)
            await cleanup_paused.wait()
            body = {"code": _fresh_totp_code(secret)} if action == "confirm" else None
            request = asyncio.create_task(client.post(f"/auth/2fa/{action}", headers=auth, json=body))
            tasks.append(request)
            await action_started.wait()
            await _wait_for_cleanup_overlap(request, pids["cleanup"], pids["action"])
            release_cleanup.set()
            login_response, action_response = await asyncio.gather(*tasks)
    finally:
        release_cleanup.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    assert login_response.status_code == 200
    assert action_response.status_code == 400
    async with TestSession() as db:
        assert await db.get(TotpCredential, user_id) is None
        assert (await db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == user_id))).all() == []


async def test_totp_completion_preserves_its_factor_when_login_cleanup_overlaps(client, monkeypatch):
    """Cleanup waits for a completing credential and then preserves its confirmed factor and active codes"""
    auth, _, user_id = await _stage_totp(client)
    now = datetime.now(UTC)
    await _age_totp_staging(user_id, now - timedelta(seconds=1801))
    _freeze_staging_cleanup(monkeypatch, now)
    completion_paused = asyncio.Event()
    cleanup_started = asyncio.Event()
    release_completion = asyncio.Event()
    pids = {}
    original_mark = two_factor.mark_totp_confirmed
    original_sweep = login_route.__globals__["prune_stale_factor_staging"]

    async def pause_completion(db, owner_id):
        """Pause after the real credential read without autoflushing its pending confirmation"""
        pids["completion"] = await db.scalar(select(func.pg_backend_pid()))
        result = await original_mark(db, owner_id)
        completion_paused.set()
        await release_completion.wait()
        return result

    async def observe_cleanup(db, owner_id):
        """Identify the cleanup transaction before its real deletion"""
        pids["cleanup"] = await db.scalar(select(func.pg_backend_pid()))
        cleanup_started.set()
        await original_sweep(db, owner_id)

    monkeypatch.setattr(two_factor, "mark_totp_confirmed", pause_completion)
    monkeypatch.setitem(login_route.__globals__, "prune_stale_factor_staging", observe_cleanup)
    tasks = []
    try:
        async with asyncio.timeout(5):
            tasks.append(asyncio.create_task(client.post("/auth/2fa/complete", headers=auth)))
            await completion_paused.wait()
            login = asyncio.create_task(client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD}))
            tasks.append(login)
            await cleanup_started.wait()
            await _wait_for_cleanup_overlap(login, pids["completion"], pids["cleanup"])
            release_completion.set()
            completion_response, login_response = await asyncio.gather(*tasks)
    finally:
        release_completion.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    assert completion_response.status_code == 204
    assert login_response.status_code == 200
    assert login_response.json()["totp_enabled"] is True
    async with TestSession() as db:
        assert (await db.get(TotpCredential, user_id)).confirmed_at is not None
        codes = (await db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == user_id))).all()
    assert len(codes) == 10
    assert all(not row.pending for row in codes)


async def test_totp_enrolment_reuses_existing_recovery_codes(client):
    """Enrolling TOTP when recovery codes already exist turns it on without issuing a new batch"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    await _seed_active_recovery_code(signup.json()["user"]["id"])

    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})

    # No new codes, and two-factor is on with no completion step
    assert confirm.status_code == 200
    assert confirm.json()["recovery_codes"] == []
    assert (await client.get("/auth/2fa/status", headers=auth)).json()["totp_enabled"] is True


async def test_status_reflects_enrolment(client):
    """The status endpoint reports false before enrolment and true after"""
    auth = _get_auth_header(await _create_user(client))

    before = await client.get("/auth/2fa/status", headers=auth)
    assert before.status_code == 200
    assert before.json()["totp_enabled"] is False

    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    after = await client.get("/auth/2fa/status", headers=auth)
    assert after.json()["totp_enabled"] is True


async def test_confirm_returns_recovery_codes_but_leaves_two_factor_pending(client):
    """Confirm returns the one-time recovery codes yet two-factor stays off until completion"""
    auth = _get_auth_header(await _create_user(client))

    setup = await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})
    assert setup.status_code == 200
    body = setup.json()
    assert body["provisioning_uri"].startswith("otpauth://totp/")

    code = pyotp.TOTP(body["secret"]).now()
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": code})
    assert confirm.status_code == 200

    codes = confirm.json()["recovery_codes"]
    assert len(codes) == 10
    assert all(code.count("-") == 4 for code in codes)

    # Closing the recovery code screen without completing must leave two-factor un-enrolled
    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is False


async def test_complete_turns_on_two_factor_after_confirm(client):
    """Completing enrolment after confirm turns two-factor on"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})

    complete = await client.post("/auth/2fa/complete", headers=auth)
    assert complete.status_code == 204

    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is True


async def test_complete_without_confirm_is_rejected(client):
    """Completing before a code is confirmed is refused so 2FA never enables around an unverified secret"""
    auth = _get_auth_header(await _create_user(client))
    await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})

    complete = await client.post("/auth/2fa/complete", headers=auth)
    assert complete.status_code == 400

    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is False


async def test_restarting_setup_discards_staged_codes(client):
    """Restarting setup clears a stale staged batch, so completion still needs a fresh confirm"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})

    # Restart setup without confirming the new secret, then try to finish off the stale staged batch
    await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})
    complete = await client.post("/auth/2fa/complete", headers=auth)
    assert complete.status_code == 400

    status = await client.get("/auth/2fa/status", headers=auth)
    assert status.json()["totp_enabled"] is False


async def test_confirm_rejects_a_wrong_code(client):
    """Confirming with an invalid code returns 400 and does not enable 2FA"""
    auth = _get_auth_header(await _create_user(client))
    await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})

    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": "000000"})
    assert confirm.status_code == 400


async def test_setup_without_reauthentication_is_rejected(client):
    """Beginning enrolment with no step-up is refused, so a stolen access token cannot enable a factor"""
    auth = _get_auth_header(await _create_user(client))

    setup = await client.post("/auth/2fa/setup", headers=auth, json={})
    assert setup.status_code == 401
    assert (await client.get("/auth/2fa/status", headers=auth)).json()["totp_enabled"] is False


async def test_setup_conflicts_once_confirmed(client):
    """Re-running setup over confirmed 2FA is refused so a live factor is never replaced silently"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    # Two-factor is on now, so re-running setup steps up with the live authenticator before it conflicts
    again = await client.post(
        "/auth/2fa/setup",
        headers=auth,
        json={"step_up": {"password": _PASSWORD, "code": _fresh_totp_code(secret)}},
    )
    assert again.status_code == 409


async def test_disable_turns_off_two_factor(client):
    """A correct password and code disables 2FA, after which setup is allowed again"""
    auth, secret, _ = await _enroll(client)

    disable = await client.post(
        "/auth/2fa/disable", headers=auth, json={"password": _PASSWORD, "code": _fresh_totp_code(secret)}
    )
    assert disable.status_code == 204
    assert (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).status_code == 200


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


async def test_disable_rejects_a_recovery_code_and_a_missing_factor(client):
    """Step-up at disable refuses a recovery code and a missing second factor, leaving 2FA on"""
    auth, _, codes = await _enroll(client)

    # A recovery code is a login-only break-glass, not a step-up factor
    with_recovery = await client.post("/auth/2fa/disable", headers=auth, json={"password": _PASSWORD, "code": codes[0]})
    assert with_recovery.status_code == 401

    # Neither a code nor a passkey is a bad request
    missing = await client.post("/auth/2fa/disable", headers=auth, json={"password": _PASSWORD})
    assert missing.status_code == 400

    assert (await client.get("/auth/2fa/status", headers=auth)).json()["totp_enabled"] is True


async def test_disabling_only_totp_clears_recovery_codes(client):
    """Disabling the sole second factor clears the shared recovery batch"""
    auth, secret, user_id = await _enroll_with_id(client)

    disable = await client.post(
        "/auth/2fa/disable", headers=auth, json={"password": _PASSWORD, "code": _fresh_totp_code(secret)}
    )
    assert disable.status_code == 204

    async with TestSession() as db:
        remaining = (
            await db.execute(select(RecoveryCode).where(RecoveryCode.user_id == uuid.UUID(user_id)))
        ).scalars().all()
    assert remaining == []


async def test_repeated_wrong_step_up_codes_lock_the_account(client):
    """Grinding the authenticator at step-up trips the shared lockout and signs the session out"""
    auth, _, _ = await _enroll(client)

    for _ in range(5):
        rejected = await client.post(
            "/auth/2fa/disable", headers=auth, json={"password": _PASSWORD, "code": "000000"}
        )
        assert rejected.status_code == 401

    # Tripping the lock signed the step-up session out, and a correct password is now refused at login
    assert (await client.get("/auth/2fa/status", headers=auth)).status_code == 401
    locked = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert locked.status_code == 423


async def test_wrong_step_up_code_reports_attempts_remaining(client):
    """A wrong step-up code returns the remaining allowance so the modal can warn before the lockout"""
    auth, _, _ = await _enroll(client)

    rejected = await client.post(
        "/auth/2fa/disable", headers=auth, json={"password": _PASSWORD, "code": "000000"}
    )

    assert rejected.status_code == 401
    assert rejected.headers["x-auth-attempts-remaining"] == "4"


async def test_login_second_factor_failure_hides_attempts_remaining(client):
    """The login factor step withholds the remaining count, so a grinder learns nothing about the lockout"""
    await _enroll(client)

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    verify = await client.post("/auth/2fa/verify", json={"mfa_token": login.json()["mfa_token"], "code": "000000"})

    assert verify.status_code == 401
    assert "x-auth-attempts-remaining" not in {name.lower() for name in verify.headers}


async def test_regenerate_then_confirm_swaps_the_codes(client):
    """Confirming a regeneration activates the new batch and retires the old one"""
    auth, secret, old_codes = await _enroll(client)

    regenerate = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": _fresh_totp_code(secret)}
    )
    assert regenerate.status_code == 200
    new_codes = regenerate.json()["recovery_codes"]
    assert len(new_codes) == 10
    assert set(new_codes).isdisjoint(old_codes)

    confirm = await client.post("/auth/2fa/recovery-codes/confirm", headers=auth)
    assert confirm.status_code == 204

    assert (await _login_with_code(client, old_codes[0])).status_code == 401
    assert (await _login_with_code(client, new_codes[0])).status_code == 200


async def test_abandoned_regenerate_keeps_old_codes(client):
    """A staged regeneration that is never confirmed leaves the existing codes working"""
    auth, secret, old_codes = await _enroll(client)

    regenerate = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": _fresh_totp_code(secret)}
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


async def test_totp_code_cannot_be_replayed(client):
    """A TOTP code accepted once is refused on reuse within its validity window"""
    auth, secret, _ = await _enroll(client)
    code = _fresh_totp_code(secret)

    first = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": code}
    )
    assert first.status_code == 200

    replay = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": code}
    )
    assert replay.status_code == 401


async def test_enrolment_code_cannot_be_replayed_as_a_factor(client):
    """The code that confirms enrolment is recorded as used, so it cannot then serve as a live factor"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]
    enrolment_code = pyotp.TOTP(secret).now()
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": enrolment_code})
    await client.post("/auth/2fa/complete", headers=auth)

    # Replaying the exact enrolment code at a step-up action is refused within its window
    replay = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": _PASSWORD, "code": enrolment_code}
    )
    assert replay.status_code == 401


async def test_repeated_wrong_2fa_codes_lock_the_account(client):
    """Wrong second-factor codes count toward the lockout, so the authenticator cannot be ground"""
    await _enroll(client)

    for _ in range(5):
        login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
        assert login.status_code == 200
        verify = await client.post("/auth/2fa/verify", json={"mfa_token": login.json()["mfa_token"], "code": "000000"})
        assert verify.status_code == 401

    # The shared counter has hit the limit, so even a correct password is now refused
    locked = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert locked.status_code == 423


async def test_correct_2fa_clears_the_lockout_counter(client):
    """A correct second factor resets the counter, so an earlier wrong code does not pre-lock login"""
    _, secret, _ = await _enroll(client)

    first = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    await client.post("/auth/2fa/verify", json={"mfa_token": first.json()["mfa_token"], "code": "000000"})

    second = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    verify = await client.post(
        "/auth/2fa/verify", json={"mfa_token": second.json()["mfa_token"], "code": _fresh_totp_code(secret)}
    )
    assert verify.status_code == 200


async def test_verify_completes_login_with_a_valid_code(client):
    """A valid challenge token and code returns an access token"""
    _, secret, user_id = await _enroll_with_id(client)
    mfa_token = await _issue_challenge(user_id)

    verify = await client.post("/auth/2fa/verify", json={"mfa_token": mfa_token, "code": _fresh_totp_code(secret)})
    assert verify.status_code == 200
    assert verify.json()["access_token"]


async def test_verify_rejects_a_challenge_issued_for_another_flow(client):
    """A challenge scoped to a different flow cannot complete a login, even with a valid code"""
    _, secret, user_id = await _enroll_with_id(client)
    async with TestSession() as db:
        mfa_token = await issue_mfa_challenge(db, uuid.UUID(user_id), MFA_PURPOSE_PASSWORD_RESET)

    verify = await client.post("/auth/2fa/verify", json={"mfa_token": mfa_token, "code": _fresh_totp_code(secret)})
    assert verify.status_code == 401


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

    verify = await client.post("/auth/2fa/verify", json={"mfa_token": body["mfa_token"], "code": _fresh_totp_code(secret)})
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
    assert body["user"]["second_factor_reenrollment_required"] is True


async def test_recovery_code_login_signs_out_existing_sessions(client):
    """Signing in with a recovery code revokes every session the account already held"""
    auth, _, codes = await _enroll(client)

    # The signup session is valid before the recovery sign-in
    assert (await client.get("/auth/2fa/status", headers=auth)).status_code == 200

    verify = await _login_with_code(client, codes[0])
    assert verify.status_code == 200

    # The pre-existing session is revoked, so it returns 401 rather than the 403 a live restricted
    # session would get
    assert (await client.get("/auth/2fa/status", headers=auth)).status_code == 401


async def test_restricted_session_is_blocked_from_normal_routes(client):
    """A recovery-code session cannot reach a normal protected route until it re-enrols"""
    _, _, codes = await _enroll(client)
    token = (await _login_with_code(client, codes[0])).json()["access_token"]
    restricted = {"Authorization": f"Bearer {token}"}

    blocked = await client.get("/auth/2fa/status", headers=restricted)
    assert blocked.status_code == 403


async def test_restricted_session_re_enrols_with_fresh_codes(client):
    """A recovery-code session re-enrols, gets a fresh batch, and is sent back to a fresh login"""
    _, _, old_codes = await _enroll(client)
    token = (await _login_with_code(client, old_codes[0])).json()["access_token"]
    restricted = {"Authorization": f"Bearer {token}"}

    secret = (await client.post("/auth/2fa/setup", headers=restricted, json={})).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=restricted, json={"code": pyotp.TOTP(secret).now()})
    assert confirm.status_code == 200
    new_codes = confirm.json()["recovery_codes"]
    assert set(new_codes).isdisjoint(old_codes)

    complete = await client.post("/auth/2fa/complete", headers=restricted)
    assert complete.status_code == 204

    # Completing the forced re-enrol signs the restricted session out
    assert (await client.get("/auth/2fa/status", headers=restricted)).status_code == 401

    # A fresh login with the new authenticator now succeeds with no restriction
    relogin = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    verify = await client.post(
        "/auth/2fa/verify", json={"mfa_token": relogin.json()["mfa_token"], "code": _fresh_totp_code(secret)}
    )
    assert verify.status_code == 200
    assert verify.json()["user"]["second_factor_reenrollment_required"] is False

    # The old batch is replaced, so a leftover old code no longer signs in
    assert (await _login_with_code(client, old_codes[1])).status_code == 401


async def test_old_recovery_codes_survive_an_abandoned_reenrol(client):
    """Confirming a re-enrol stages new codes, but an old code keeps working until completion"""
    _, _, old_codes = await _enroll(client)
    token = (await _login_with_code(client, old_codes[0])).json()["access_token"]
    restricted = {"Authorization": f"Bearer {token}"}

    # Confirm a fresh authenticator but abandon before completing
    secret = (await client.post("/auth/2fa/setup", headers=restricted, json={})).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=restricted, json={"code": pyotp.TOTP(secret).now()})
    assert confirm.status_code == 200

    # A remaining old code still signs in, proving the staged batch did not replace it
    again = await _login_with_code(client, old_codes[1])
    assert again.status_code == 200
    assert again.json()["user"]["second_factor_reenrollment_required"] is True


async def test_recovery_codes_are_single_use_and_deplete(client):
    """Each recovery code logs in once, and a spent code is refused while others still work"""
    _, _, codes = await _enroll(client)

    first = await _login_with_code(client, codes[0])
    assert first.status_code == 200

    reused = await _login_with_code(client, codes[0])
    assert reused.status_code == 401

    another = await _login_with_code(client, codes[1])
    assert another.status_code == 200
    assert another.json()["user"]["second_factor_reenrollment_required"] is True


async def test_login_after_recovery_reports_recovery_only(client):
    """Once the authenticator is revoked, the next login challenge signals only a recovery code works"""
    _, _, codes = await _enroll(client)
    await _login_with_code(client, codes[0])

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert login.status_code == 200
    body = login.json()
    assert body["mfa_required"] is True
    assert body["recovery_only"] is True
