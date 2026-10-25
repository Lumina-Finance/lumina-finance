"""Sign-in lockout tests: every email locks the same way, whether or not an account has it"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

from app.models.auth import LoginLockout, PasswordCredential
from app.models.auth_session import AuthSession
from app.services.auth import login_email_hash, secret_hashing
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _create_user,
    _get_login_lockout,
    _seed_currency,
    _seed_reset_token,
    sign_up_confirmed,
)

_UNKNOWN_EMAIL = "nobody@example.com"
_PROVIDER_ONLY_EMAIL = "provider-only@example.com"
_ATTEMPTS_BEFORE_LOCK = 5
_NEW_PASSWORD = "NewSecurePass123!"


async def _create_provider_only_account(client) -> None:
    """Sign up an account, then remove its password credential, as an account created through a provider has"""
    signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": _PROVIDER_ONLY_EMAIL})
    assert signup.status_code == 201
    async with TestSession() as session:
        await session.execute(delete(PasswordCredential).where(PasswordCredential.user_id == uuid.UUID(signup.json()["user"]["id"])))
        await session.commit()


async def _failed_logins(client, email: str, count: int) -> list:
    """Return the responses of the given number of wrong-password logins"""
    return [await client.post("/auth/login", json={"email": email, "password": "wrong-password"}) for _ in range(count)]


def _shape(response) -> tuple:
    """Return everything a caller can see of a response, so two responses can be compared whole"""
    return response.status_code, response.json(), sorted(response.headers.items())


async def test_registered_unknown_and_passwordless_emails_lock_identically(client):
    """The whole lockout sequence looks the same for an email with an account, one without and one with no password"""
    await _create_user(client)
    await _create_provider_only_account(client)
    emails = (SIGNUP_PAYLOAD["email"], _UNKNOWN_EMAIL, _PROVIDER_ONLY_EMAIL)

    sequences = {email: await _failed_logins(client, email, _ATTEMPTS_BEFORE_LOCK + 2) for email in emails}

    # Five refusals, then the lock, which keeps answering. Starting from the registered email's own
    # sequence makes the comparison fail loudly when an unknown one differs at any step
    registered = [_shape(response) for response in sequences[SIGNUP_PAYLOAD["email"]]]
    assert [status for status, _, _ in registered] == [401] * _ATTEMPTS_BEFORE_LOCK + [423, 423]
    assert registered[0][1] == {"detail": "Invalid credentials"}
    assert registered[-1][1] == {"detail": "Account temporarily locked"}
    for email in (_UNKNOWN_EMAIL, _PROVIDER_ONLY_EMAIL):
        assert [_shape(response) for response in sequences[email]] == registered


async def test_failures_against_a_passwordless_account_revoke_none_of_its_sessions(client):
    """An account with no password is locked like an unknown email, which signs nobody out"""
    await _seed_currency()
    await _create_provider_only_account(client)

    await _failed_logins(client, _PROVIDER_ONLY_EMAIL, _ATTEMPTS_BEFORE_LOCK)

    async with TestSession() as session:
        assert len((await session.execute(select(AuthSession))).scalars().all()) == 1


async def test_a_new_failure_moves_the_idle_clock_forward(client):
    """Each failure restarts the 7-day idle clock, so an email still being tried is not forgotten by the cleanup"""
    await _failed_logins(client, _UNKNOWN_EMAIL, 1)
    long_ago = datetime.now(UTC) - timedelta(days=6)
    async with TestSession() as session:
        (await session.execute(select(LoginLockout))).scalar_one().last_failed_at = long_ago
        await session.commit()

    await _failed_logins(client, _UNKNOWN_EMAIL, 1)

    assert (await _get_login_lockout(_UNKNOWN_EMAIL)).last_failed_at > long_ago + timedelta(days=5)


class _CountingHasher:
    """Stands in for the argon2 hasher, counting the slow work each login attempt does"""

    def __init__(self, real) -> None:
        self._real = real
        self.calls = 0

    def hash(self, value):
        """Count and run a real hash"""
        self.calls += 1
        return self._real.hash(value)

    def verify(self, secret_hash, value):
        """Count and run a real verification"""
        self.calls += 1
        return self._real.verify(secret_hash, value)


async def test_every_kind_of_email_does_one_hash_per_attempt_and_none_once_locked(client, monkeypatch):
    """Each unlocked attempt costs one argon2 run for all three kinds of email, and a locked one costs none"""
    await _create_user(client)
    await _create_provider_only_account(client)
    counter = _CountingHasher(secret_hashing._HASHER)
    monkeypatch.setattr(secret_hashing, "_HASHER", counter)

    for email in (SIGNUP_PAYLOAD["email"], _UNKNOWN_EMAIL, _PROVIDER_ONLY_EMAIL):
        counter.calls = 0
        await _failed_logins(client, email, _ATTEMPTS_BEFORE_LOCK)
        assert counter.calls == _ATTEMPTS_BEFORE_LOCK, email

        counter.calls = 0
        await _failed_logins(client, email, 2)
        assert counter.calls == 0, email


async def test_lockout_record_holds_only_a_keyed_hash_of_the_email(client, monkeypatch):
    """The stored name of an email is not its plain hash and depends on the server key, so the database alone cannot be searched"""
    await _failed_logins(client, _UNKNOWN_EMAIL, 1)

    async with TestSession() as session:
        stored = (await session.execute(select(LoginLockout))).scalar_one()
    assert stored.email_hash == login_email_hash.seal_login_email(_UNKNOWN_EMAIL)
    assert stored.email_hash != hashlib.sha256(_UNKNOWN_EMAIL.encode()).hexdigest()
    assert _UNKNOWN_EMAIL not in str(vars(stored))

    monkeypatch.setattr(login_email_hash, "_lockout_key", lambda: b"another server key")
    assert login_email_hash.seal_login_email(_UNKNOWN_EMAIL) != stored.email_hash


async def test_failures_of_an_unknown_email_leave_other_accounts_sessions_alone(client):
    """Locking an email nobody registered revokes no session of anyone else"""
    await _create_user(client)

    await _failed_logins(client, _UNKNOWN_EMAIL, _ATTEMPTS_BEFORE_LOCK)

    async with TestSession() as session:
        assert len((await session.execute(select(AuthSession))).scalars().all()) == 1


async def test_password_reset_clears_the_lockout(client):
    """Redeeming a reset link forgets the email's failures, so the owner can sign in at once"""
    signup = await _create_user(client)
    await _failed_logins(client, SIGNUP_PAYLOAD["email"], _ATTEMPTS_BEFORE_LOCK)
    raw_token = await _seed_reset_token(uuid.UUID(signup.json()["user"]["id"]))

    reset = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert reset.status_code == 204

    assert await _get_login_lockout(SIGNUP_PAYLOAD["email"]) is None
    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _NEW_PASSWORD})
    assert login.status_code == 200
