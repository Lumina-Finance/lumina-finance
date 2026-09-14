"""Password reset request and consume route tests"""

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pyotp
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordCredential, PasswordResetToken
from app.services.auth import password_reset
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _fresh_totp_code, _get_auth_header, _seed_reset_token

_NEW_PASSWORD = "NewSecurePass123!"


@pytest.fixture
def sent_reset_emails(monkeypatch):
    """Record delivered email recipients without replacing token issuance"""
    recipients = []

    async def record_send(email, _message):
        """Record a successful delivery"""
        recipients.append(email)

    monkeypatch.setattr(password_reset, "get_email_sender", lambda: SimpleNamespace(send=record_send))
    return recipients


async def _overlap_reset_requests(client, monkeypatch, first_email, second_email, *, independent=False):
    """Hold the first real issuance transaction while the second completes or waits on it"""
    first_paused = asyncio.Event()
    second_started = asyncio.Event()
    release_first = asyncio.Event()
    request_pids = []
    gate_used = False
    original_lookup = password_reset.find_user_id_by_email
    original_commit = AsyncSession.commit

    async def observe_lookup(db, email):
        """Identify the real request transactions before they check the allowance"""
        user_id = await original_lookup(db, email)
        request_pids.append(await db.scalar(select(func.pg_backend_pid())))
        if len(request_pids) == 2:
            second_started.set()
        return user_id

    async def pause_first_issuance(db):
        """Flush the first new token and retain its transaction until the overlap is observed"""
        nonlocal gate_used
        if not gate_used and any(isinstance(row, PasswordResetToken) for row in db.new):
            gate_used = True
            await db.flush()
            first_paused.set()
            await release_first.wait()
        await original_commit(db)

    monkeypatch.setattr(password_reset, "find_user_id_by_email", observe_lookup)
    monkeypatch.setattr(AsyncSession, "commit", pause_first_issuance)
    tasks = []
    try:
        async with asyncio.timeout(5):
            tasks.append(asyncio.create_task(client.post("/auth/password/forgot", json={"email": first_email})))
            await first_paused.wait()
            second = asyncio.create_task(client.post("/auth/password/forgot", json={"email": second_email}))
            tasks.append(second)
            await second_started.wait()

            if independent:
                await second
            else:
                async with TestSession() as observer:
                    while not second.done():
                        blockers = await observer.scalar(
                            text("SELECT pg_blocking_pids(:pid)"), {"pid": request_pids[1]}
                        )
                        if request_pids[0] in blockers:
                            break
                        await asyncio.sleep(0.01)

            release_first.set()
            return await asyncio.gather(*tasks)
    finally:
        release_first.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


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


async def test_forgot_password_drops_the_token_when_the_email_fails(client, monkeypatch, sent_reset_emails):
    """A send failure preserves earlier send history and allows a later retry"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    await _seed_reset_token(user_id, raw_token="earlier-expired-send", expires_in_seconds=-60)
    original_id = (await _reset_tokens_for(user_id))[0].id

    async def failing_send(*_args, **_kwargs):
        """Simulate an unavailable mail server"""
        raise RuntimeError("smtp is down")

    with monkeypatch.context() as failed_delivery:
        failed_delivery.setattr(password_reset, "get_email_sender", lambda: SimpleNamespace(send=failing_send))
        resp = await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})

    # Keep the earlier send record while removing only the failed issuance
    assert resp.status_code == 204
    assert [row.id for row in await _reset_tokens_for(user_id)] == [original_id]

    retry = await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})
    assert retry.status_code == 204
    rows = await _reset_tokens_for(user_id)
    assert len(rows) == 2
    assert original_id in {row.id for row in rows}
    assert sum(row.used_at is None and row.expires_at > datetime.now(UTC) for row in rows) == 1
    assert sent_reset_emails == [SIGNUP_PAYLOAD["email"]]


@pytest.mark.parametrize("prior_sends", [0, 2])
async def test_overlapping_reset_requests_share_the_allowance(client, monkeypatch, sent_reset_emails, prior_sends):
    """Concurrent requests cannot duplicate a live link or exceed the last daily allowance"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    for index in range(prior_sends):
        await _seed_reset_token(user_id, raw_token=f"expired-{index}", expires_in_seconds=-60)

    responses = await _overlap_reset_requests(
        client, monkeypatch, SIGNUP_PAYLOAD["email"], SIGNUP_PAYLOAD["email"]
    )

    assert [response.status_code for response in responses] == [204, 204]
    rows = await _reset_tokens_for(user_id)
    assert len(rows) == prior_sends + 1
    assert sum(row.used_at is None and row.expires_at > datetime.now(UTC) for row in rows) == 1
    assert sent_reset_emails == [SIGNUP_PAYLOAD["email"]]


async def test_overlapping_reset_requests_for_different_users_are_independent(client, monkeypatch, sent_reset_emails):
    """Another user's reset request completes while the first issuance remains uncommitted"""
    first = await _create_user(client)
    second_email = "second@example.com"
    second = await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "email": second_email})
    assert second.status_code == 201

    responses = await _overlap_reset_requests(
        client, monkeypatch, SIGNUP_PAYLOAD["email"], second_email, independent=True
    )

    assert [response.status_code for response in responses] == [204, 204]
    assert len(await _reset_tokens_for(uuid.UUID(first.json()["user"]["id"]))) == 1
    assert len(await _reset_tokens_for(uuid.UUID(second.json()["user"]["id"]))) == 1
    assert sent_reset_emails == [second_email, SIGNUP_PAYLOAD["email"]]


async def test_forgot_password_unknown_email_creates_no_token(client):
    """An unknown email still returns 204 but issues no token, avoiding enumeration"""
    resp = await client.post("/auth/password/forgot", json={"email": "nobody@example.com"})

    assert resp.status_code == 204
    async with TestSession() as session:
        token_count = await session.scalar(select(func.count()).select_from(PasswordResetToken))
        assert token_count == 0


async def test_forgot_password_keeps_the_live_link_and_sends_nothing_new(client):
    """Requesting again while the earlier link still works issues no new token"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])

    await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})
    first_hash = (await _reset_tokens_for(user_id))[0].token_hash

    resp = await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})
    rows = await _reset_tokens_for(user_id)

    assert resp.status_code == 204
    assert len(rows) == 1
    assert rows[0].token_hash == first_hash


async def test_forgot_password_sends_again_after_the_link_expires(client):
    """A dead link no longer blocks a fresh one, and the old row stays as the send record"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    await _seed_reset_token(user_id, raw_token="expired-link", expires_in_seconds=-60)

    resp = await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})
    rows = await _reset_tokens_for(user_id)

    assert resp.status_code == 204
    assert len(rows) == 2
    assert sum(1 for row in rows if row.used_at is None and row.expires_at > datetime.now(UTC)) == 1


async def test_forgot_password_stops_after_the_daily_email_limit(client):
    """Requests beyond the rolling-day limit still return 204 but issue no token"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    for index in range(3):
        await _seed_reset_token(user_id, raw_token=f"spent-link-{index}", expires_in_seconds=-60)

    resp = await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})

    assert resp.status_code == 204
    assert len(await _reset_tokens_for(user_id)) == 3


async def test_forgot_password_prunes_rows_older_than_the_rolling_day(client):
    """A send older than the rolling day stops counting toward the limit and gets pruned"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    await _seed_reset_token(user_id, raw_token="yesterday-link", expires_in_seconds=-90000, age_seconds=90000)

    resp = await client.post("/auth/password/forgot", json={"email": SIGNUP_PAYLOAD["email"]})
    rows = await _reset_tokens_for(user_id)

    assert resp.status_code == 204
    assert len(rows) == 1
    assert rows[0].used_at is None and rows[0].expires_at > datetime.now(UTC)


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


async def test_reset_during_reenrollment_requires_a_remaining_recovery_code(client):
    """A recovery-only account cannot reset again without proving a remaining recovery code"""
    signup, _, recovery_codes = await _enroll_totp(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])

    login = await client.post(
        "/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]}
    )
    recovery_login = await client.post(
        "/auth/2fa/verify",
        json={"mfa_token": login.json()["mfa_token"], "code": recovery_codes[0]},
    )
    assert recovery_login.status_code == 200
    assert recovery_login.json()["user"]["second_factor_reenrollment_required"] is True

    raw_token = await _seed_reset_token(user_id)
    async with TestSession() as session:
        original_hash = (await session.get(PasswordCredential, user_id)).password_hash

    begin = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})

    assert begin.status_code == 200
    challenge = begin.json()
    assert challenge["mfa_required"] is True
    assert challenge["recovery_only"] is True
    assert challenge["totp_enabled"] is False
    assert challenge["passkey_available"] is False
    assert (await _reset_tokens_for(user_id))[0].used_at is None
    async with TestSession() as session:
        assert (await session.get(PasswordCredential, user_id)).password_hash == original_hash

    verify = await client.post(
        "/auth/password/reset/verify",
        json={
            "token": raw_token,
            "new_password": _NEW_PASSWORD,
            "mfa_token": challenge["mfa_token"],
            "code": recovery_codes[1],
        },
    )
    assert verify.status_code == 200
    restricted = {"Authorization": f"Bearer {verify.json()['access_token']}"}
    assert (await _reset_tokens_for(user_id))[0].used_at is not None

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _NEW_PASSWORD})
    assert login.status_code == 200
    assert login.json()["recovery_only"] is True
    assert (await client.get("/test/me", headers=restricted)).status_code == 403


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


async def test_reset_sets_first_password_for_provider_account(client):
    """Redeeming a reset link gives a provider-created account its first password"""
    from app.models.auth import AuthIdentity, PasswordCredential
    from app.models.base import AuthProvider
    from app.models.user import User
    from tests.routes.support import _seed_currency

    await _seed_currency()

    # A provider-created account has a user row and an OIDC auth identity but no credential
    user_id = uuid.uuid4()
    async with TestSession() as session:
        session.add(
            User(
                id=user_id,
                email="sso-user@example.com",
                first_name="Sso",
                tz="America/Toronto",
                base_currency="CAD",
            )
        )

        # The identity references the user, and without a mapped relationship the unit of
        # work cannot order the two inserts, so the user must land first
        await session.flush()
        session.add(AuthIdentity(user_id=user_id, auth_provider=AuthProvider.OIDC, email_verified=True))
        await session.commit()

    raw_token = await _seed_reset_token(user_id)
    resp = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert resp.status_code == 204

    async with TestSession() as session:
        credential = (
            await session.execute(select(PasswordCredential).where(PasswordCredential.user_id == user_id))
        ).scalar_one()
        password_identity = (
            await session.execute(
                select(AuthIdentity).where(
                    AuthIdentity.user_id == user_id, AuthIdentity.auth_provider == AuthProvider.PASSWORD
                )
            )
        ).scalar_one()
    assert credential.password_hash != _NEW_PASSWORD
    assert password_identity is not None

    login = await client.post("/auth/login", json={"email": "sso-user@example.com", "password": _NEW_PASSWORD})
    assert login.status_code == 200
