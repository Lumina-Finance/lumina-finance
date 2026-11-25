import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

import pytest
from sqlalchemy import select, text

from app.config.imports import ABANDONED_RUN_AGE, IMPORT_UNDO_WINDOW
from app.config.two_factor import TWO_FACTOR_STAGING_EXPIRE_SECONDS
from app.encryption import encrypt
from app.models.auth import (
    EmailChangeRequest,
    LoginLockout,
    MfaChallenge,
    PasswordResetToken,
    RecoveryCode,
    SignupEmailSend,
    TotpCredential,
    WebauthnChallenge,
    WebauthnCredential,
)
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken, AuthTokenKind
from app.models.bank_authorization import BankAuthorization
from app.models.bank_connection import BankConnection
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.models.currency import Currency
from app.models.import_run import ImportRun, ImportRunSource
from app.models.oidc import OidcAuthorizationRequest, OidcProvider
from app.models.user import User
from app.services.maintenance import expired_records
from app.services.maintenance.expired_records import ExpiredRecordKind, prune_expired_records
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_connection
from tests.routes.support.profile_deletion_helpers import _commit_user, _stored_marks
from tests.routes.support.query_cost_helpers import SLACK, _avoid_full_scans, _rows_read


async def _seed_numbered_users(count: int) -> list[User]:
    """Insert users sharing one base currency, since the scheduled cleanup spans every account"""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        users = [User(email=f"user{index}@example.com", first_name="User", tz="America/Toronto", base_currency="CAD") for index in range(count)]
        session.add_all(users)
        await session.commit()
    return users


async def _remaining_ids(model, key="id") -> set:
    """Return the key of every row of the model still stored"""
    async with TestSession() as session:
        return set(await session.scalars(select(getattr(model, key))))


def _import_run(owner: User, *, created_at: datetime, committed_at: datetime | None = None) -> ImportRun:
    """Build an import run uploaded and, optionally, committed at the given times"""
    return ImportRun(
        owner_id=owner.id,
        source=ImportRunSource.GENERIC,
        expected_transaction_count=1,
        created_at=created_at,
        committed_at=committed_at,
    )


async def test_prunes_expired_records_of_every_kind_across_users_and_keeps_live_ones():
    """Every kind loses its expired rows for every user, while live rows and confirmed factors stay"""
    now = datetime.now(UTC)
    past = now - timedelta(minutes=1)
    future = now + timedelta(hours=1)
    staging_expired = now - timedelta(seconds=TWO_FACTOR_STAGING_EXPIRE_SECONDS + 60)
    first, second = await _seed_numbered_users(2)
    provider = OidcProvider(
        slug="test",
        display_name="Test IdP",
        issuer="https://idp.example.com",
        client_id="client",
        client_secret_encrypted=encrypt("secret"),
        scopes="openid email",
        enabled=True,
    )
    expired_session = AuthSession(user_id=first.id, expires_at=past)
    live_session = AuthSession(user_id=second.id, expires_at=future)
    async with TestSession() as session:
        session.add_all([provider, expired_session, live_session])
        await session.flush()
        expired_token = AuthToken(
            jti=uuid.uuid4(),
            user_id=second.id,
            session_id=live_session.id,
            token_kind=AuthTokenKind.REFRESH,
            expires_at=past,
        )
        live_token = AuthToken(
            jti=uuid.uuid4(),
            user_id=second.id,
            session_id=live_session.id,
            token_kind=AuthTokenKind.ACCESS,
            expires_at=future,
        )
        expired_passkey_challenge = WebauthnChallenge(challenge=b"old", user_id=first.id, purpose="registration", expires_at=past)
        live_passkey_challenge = WebauthnChallenge(challenge=b"new", purpose="authentication", expires_at=future)
        expired_mfa = MfaChallenge(jti=uuid.uuid4(), user_id=first.id, expires_at=past)
        live_mfa = MfaChallenge(jti=uuid.uuid4(), user_id=second.id, expires_at=future)
        expired_oidc = OidcAuthorizationRequest(
            state_hash="old",
            nonce="n",
            code_verifier="v",
            provider_id=provider.id,
            expires_at=past,
        )
        live_oidc = OidcAuthorizationRequest(
            state_hash="new",
            nonce="n",
            code_verifier="v",
            provider_id=provider.id,
            expires_at=future,
        )
        stale_reset = PasswordResetToken(
            user_id=first.id,
            token_hash="old",
            expires_at=past,
            created_at=now - timedelta(hours=25),
        )
        recent_reset = PasswordResetToken(
            user_id=second.id,
            token_hash="new",
            expires_at=past,
            created_at=now - timedelta(hours=23),
        )
        expired_email_change = EmailChangeRequest(user_id=first.id, new_email="old@example.org", token_hash="old", expires_at=past)
        live_email_change = EmailChangeRequest(user_id=second.id, new_email="new@example.org", token_hash="new", expires_at=future)
        stale_passkey = WebauthnCredential(
            user_id=first.id,
            credential_id=b"stale",
            public_key=b"k",
            name="Stale",
            created_at=staging_expired,
        )
        confirmed_passkey = WebauthnCredential(
            user_id=second.id,
            credential_id=b"kept",
            public_key=b"k",
            name="Kept",
            created_at=staging_expired,
            confirmed_at=staging_expired,
        )
        stale_totp = TotpCredential(user_id=first.id, secret_encrypted="s", created_at=staging_expired)
        confirmed_totp = TotpCredential(
            user_id=second.id,
            secret_encrypted="s",
            created_at=staging_expired,
            confirmed_at=staging_expired,
        )
        stale_code = RecoveryCode(user_id=first.id, code_hash="stale", pending=True, created_at=staging_expired)
        active_code = RecoveryCode(user_id=second.id, code_hash="kept", pending=False, created_at=staging_expired)
        session.add_all(
            [
                expired_token,
                live_token,
                expired_passkey_challenge,
                live_passkey_challenge,
                expired_mfa,
                live_mfa,
                expired_oidc,
                live_oidc,
                stale_reset,
                recent_reset,
                expired_email_change,
                live_email_change,
                stale_passkey,
                confirmed_passkey,
                stale_totp,
                confirmed_totp,
                stale_code,
                active_code,
            ]
        )
        await session.commit()

    await prune_expired_records(ScopedSession)

    assert await _remaining_ids(AuthSession) == {live_session.id}
    assert await _remaining_ids(AuthToken, "jti") == {live_token.jti}
    assert await _remaining_ids(WebauthnChallenge) == {live_passkey_challenge.id}
    assert await _remaining_ids(MfaChallenge, "jti") == {live_mfa.jti}
    assert await _remaining_ids(OidcAuthorizationRequest) == {live_oidc.id}
    assert await _remaining_ids(PasswordResetToken) == {recent_reset.id}
    assert await _remaining_ids(EmailChangeRequest) == {live_email_change.id}
    assert await _remaining_ids(WebauthnCredential) == {confirmed_passkey.id}
    assert await _remaining_ids(TotpCredential, "user_id") == {second.id}
    assert await _remaining_ids(RecoveryCode) == {active_code.id}


async def test_prunes_abandoned_and_undo_expired_import_runs_for_every_user():
    """Abandoned uploads and runs past their undo window go, while runs still in use stay"""
    now = datetime.now(UTC)
    first, second = await _seed_numbered_users(2)
    long_ago = now - max(ABANDONED_RUN_AGE, IMPORT_UNDO_WINDOW) - timedelta(hours=1)
    abandoned = _import_run(first, created_at=now - ABANDONED_RUN_AGE - timedelta(minutes=1))
    undo_expired = _import_run(second, created_at=long_ago, committed_at=now - IMPORT_UNDO_WINDOW - timedelta(minutes=1))
    in_progress = _import_run(first, created_at=now - ABANDONED_RUN_AGE + timedelta(minutes=5))
    # Uploaded long ago but committed recently, so it is still inside its undo window
    still_undoable = _import_run(second, created_at=long_ago, committed_at=now - IMPORT_UNDO_WINDOW + timedelta(minutes=5))
    async with TestSession() as session:
        session.add_all([abandoned, undo_expired, in_progress, still_undoable])
        await session.commit()

    await prune_expired_records(ScopedSession)

    assert await _remaining_ids(ImportRun) == {in_progress.id, still_undoable.id}


async def test_passes_over_an_abandoned_import_run_another_request_holds():
    """A run a commit still holds is left for that commit to settle, rather than waited on or deleted"""
    (owner,) = await _seed_numbered_users(1)
    held = _import_run(owner, created_at=datetime.now(UTC) - ABANDONED_RUN_AGE - timedelta(minutes=1))
    async with TestSession() as session:
        session.add(held)
        await session.commit()

    # Bounded so that waiting on the held run fails this test rather than hanging it
    async with TestSession() as holder:
        await holder.execute(text("SELECT id FROM import_runs WHERE id = :id FOR UPDATE"), {"id": held.id})
        async with asyncio.timeout(5):
            await prune_expired_records(ScopedSession)
        await holder.rollback()

    assert await _remaining_ids(ImportRun) == {held.id}


async def test_prunes_bank_sync_jobs_finished_over_30_days_ago_for_every_user():
    """A finished job past its retention goes for any user, while a newer one and unfinished ones stay"""
    now = datetime.now(UTC)
    first, second = await _seed_numbered_users(2)
    first_connection, second_connection = _build_bank_connection(first.id), _build_bank_connection(second.id)
    finished = {"status": BankSyncJobStatus.SUCCEEDED, "attempt": 1}

    def job(connection: BankConnection, **values) -> BankSyncJob:
        return BankSyncJob(owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.SCHEDULED, **values)

    past_retention = job(first_connection, finished_at=now - timedelta(days=30, minutes=1), **finished)
    other_users_past_retention = job(second_connection, finished_at=now - timedelta(days=60), **finished)
    within_retention = job(second_connection, finished_at=now - timedelta(days=29, hours=23), **finished)
    queued = job(first_connection)
    async with TestSession() as session:
        session.add_all([first_connection, second_connection])
        await session.flush()
        session.add_all([past_retention, other_users_past_retention, within_retention, queued])
        await session.commit()

    await prune_expired_records(ScopedSession)

    assert await _remaining_ids(BankSyncJob) == {within_retention.id, queued.id}


async def test_prunes_bank_sign_ins_past_their_expiry_for_every_user_and_keeps_open_ones():
    """A sign-in whose user never returned goes with its stored credentials for any user, while one still open stays"""
    now = datetime.now(UTC)
    first, second, third = await _seed_numbered_users(3)

    def sign_in(owner: User, state: str, expires_at: datetime) -> BankAuthorization:
        return BankAuthorization(
            owner_id=owner.id,
            provider="signin_bank",
            credentials_encrypted=encrypt("{}"),
            state_hash=state,
            expires_at=expires_at,
        )

    expired = sign_in(first, "expired", now - timedelta(seconds=1))
    other_users_expired = sign_in(second, "other", now - timedelta(hours=5))
    still_open = sign_in(third, "open", now + timedelta(minutes=5))
    async with TestSession() as session:
        session.add_all([expired, other_users_expired, still_open])
        await session.commit()

    await prune_expired_records(ScopedSession)

    assert await _remaining_ids(BankAuthorization) == {still_open.id}


async def test_the_cleanup_forgets_failure_counts_idle_for_a_week_and_keeps_recent_ones():
    """Counts of emails nobody has failed with for a week go, so anonymous requests cannot grow the table forever"""
    idle_week = datetime.now(UTC) - timedelta(days=7, minutes=1)
    async with TestSession() as session:
        session.add_all(
            [
                LoginLockout(email_hash="idle", bucket_hash="", failed_attempt_count=3, last_failed_at=idle_week),
                LoginLockout(email_hash="recent", bucket_hash="", failed_attempt_count=3, last_failed_at=idle_week + timedelta(hours=1)),
            ]
        )
        await session.commit()

    await prune_expired_records(ScopedSession)

    assert await _remaining_ids(LoginLockout, "email_hash") == {"recent"}


async def test_a_failing_kind_is_logged_and_the_kinds_around_it_still_commit(monkeypatch, caplog):
    """A cleanup that fails mid-statement is logged, and neither the kind before nor after it is lost"""
    past = datetime.now(UTC) - timedelta(minutes=1)
    (owner,) = await _seed_numbered_users(1)
    expired_mfa = MfaChallenge(jti=uuid.uuid4(), user_id=owner.id, expires_at=past)
    expired_passkey_challenge = WebauthnChallenge(challenge=b"old", purpose="authentication", expires_at=past)
    async with TestSession() as session:
        session.add_all([expired_mfa, expired_passkey_challenge])
        await session.commit()

    async def fail_mid_statement(db):
        await db.execute(text("SELECT 1 / 0"))

    kinds = {kind.name: kind for kind in expired_records.EXPIRED_RECORD_KINDS}
    monkeypatch.setattr(
        expired_records,
        "EXPIRED_RECORD_KINDS",
        (
            kinds["MFA challenges"],
            ExpiredRecordKind("broken records", fail_mid_statement),
            kinds["passkey challenges"],
        ),
    )

    with caplog.at_level(logging.WARNING, logger=expired_records.__name__):
        await prune_expired_records(ScopedSession)

    (warning,) = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert "broken records" in warning.getMessage()
    assert warning.exc_info is not None
    assert await _remaining_ids(MfaChallenge, "jti") == set()
    assert await _remaining_ids(WebauthnChallenge) == set()


async def test_a_pass_reminds_waiting_profiles_close_to_their_date_and_deletes_the_ones_due(sent_action_emails):
    """One pass sends the reminder of a profile three days or less from its date, deletes a profile past it, and leaves one further off"""
    now = datetime.now(UTC)
    reminded = await _commit_user("reminded@example.com", requested_at=now - timedelta(days=8), due_at=now + timedelta(days=2))
    due = await _commit_user("due@example.com", requested_at=now - timedelta(days=8), due_at=now - timedelta(hours=1), with_account=True)
    waiting = await _commit_user("waiting@example.com", requested_at=now - timedelta(days=1), due_at=now + timedelta(days=6))

    await prune_expired_records(ScopedSession)

    assert sorted((recipient, message.subject) for recipient, message in sent_action_emails) == [
        ("due@example.com", "Your profile was deleted"),
        ("reminded@example.com", "Your profile will be deleted in 3 days or less"),
    ]
    assert await _stored_marks(due) is None
    assert (await _stored_marks(reminded))[2] is not None
    assert await _stored_marks(waiting) == (waiting.deletion_requested_at, waiting.deletion_due_at, None)


async def test_a_pass_whose_reminders_fail_still_deletes_the_profiles_due(monkeypatch, caplog):
    """A failure listing the reminders is logged, and the deletions after it still run"""

    async def fail(session_factory):
        raise RuntimeError("cannot list")

    monkeypatch.setattr(expired_records, "send_due_reminders", fail)
    now = datetime.now(UTC)
    due = await _commit_user("due@example.com", requested_at=now - timedelta(days=8), due_at=now - timedelta(hours=1), with_account=True)

    with caplog.at_level(logging.WARNING, logger=expired_records.__name__):
        await prune_expired_records(ScopedSession)

    assert "Profile deletion reminders could not be sent" in caplog.text
    assert await _stored_marks(due) is None


async def test_the_schedule_keeps_pruning_until_cancelled(monkeypatch):
    """The cleanup timer prunes again after each interval rather than once"""
    runs = 0
    second_run = asyncio.Event()

    async def count_run():
        nonlocal runs
        runs += 1
        if runs == 2:
            second_run.set()

    monkeypatch.setattr(expired_records, "prune_expired_records", count_run)
    monkeypatch.setattr(expired_records, "EXPIRED_RECORD_PRUNE_INTERVAL", timedelta(0))

    async with expired_records.run_cleanup_timer():
        await asyncio.wait_for(second_run.wait(), timeout=5)


# How many rows of each kind the cleanup must leave alone. Enough that reading them all shows
LIVE_ROWS = 300

# Long ago, for rows that match a kind's age test but not its other conditions
LONG_AGO = timedelta(days=40)


class _RowsReadCase(NamedTuple):
    """A kind's rows to seed, and how many expired rows of each table the cleanup removes"""

    seed: Callable[[], Awaitable[None]]
    expired_rows: dict[str, int]


async def _save(*groups: Iterable[object]) -> None:
    """Commit the rows and take the statistics a real database has, so the planner sees them"""
    async with TestSession() as session:
        for group in groups:
            session.add_all(group)
        await session.commit()
        await session.execute(text("ANALYZE"))
        await session.commit()


async def _seed_crowd() -> list[uuid.UUID]:
    """Save a user for every live row, and a few more for the expired ones, returning their ids"""
    return [user.id for user in await _seed_numbered_users(LIVE_ROWS + 3)]


async def _seed_auth_sessions() -> None:
    owners, now = await _seed_crowd(), datetime.now(UTC)
    live = [AuthSession(user_id=owner, expires_at=now + timedelta(hours=1)) for owner in owners[:LIVE_ROWS]]
    await _save(live, [AuthSession(user_id=owners[LIVE_ROWS], expires_at=now - timedelta(minutes=1))])


async def _seed_auth_tokens() -> None:
    owners, now = await _seed_crowd(), datetime.now(UTC)
    sessions = [AuthSession(user_id=owner, expires_at=now + timedelta(hours=1)) for owner in owners[: LIVE_ROWS + 2]]
    await _save(sessions)

    def access_token(session: AuthSession, expires_at: datetime) -> AuthToken:
        return AuthToken(
            jti=uuid.uuid4(), user_id=session.user_id, session_id=session.id, token_kind=AuthTokenKind.ACCESS, expires_at=expires_at
        )

    live = [access_token(session, now + timedelta(hours=1)) for session in sessions[:LIVE_ROWS]]
    past_lifetime = access_token(sessions[LIVE_ROWS], now - timedelta(minutes=1))
    grace_ended = AuthToken(
        jti=uuid.uuid4(),
        user_id=sessions[LIVE_ROWS + 1].user_id,
        session_id=sessions[LIVE_ROWS + 1].id,
        token_kind=AuthTokenKind.REFRESH,
        expires_at=now + timedelta(days=30),
        refresh_grace_expires_at=now - timedelta(minutes=1),
    )
    await _save(live, [past_lifetime, grace_ended])


async def _seed_passkey_challenges() -> None:
    now = datetime.now(UTC)
    live = [
        WebauthnChallenge(challenge=f"live{index}".encode(), purpose="authentication", expires_at=now + timedelta(minutes=5))
        for index in range(LIVE_ROWS)
    ]
    await _save(live, [WebauthnChallenge(challenge=b"expired", purpose="authentication", expires_at=now - timedelta(minutes=1))])


async def _seed_mfa_challenges() -> None:
    owners, now = await _seed_crowd(), datetime.now(UTC)
    live = [MfaChallenge(jti=uuid.uuid4(), user_id=owner, expires_at=now + timedelta(minutes=5)) for owner in owners[:LIVE_ROWS]]
    await _save(live, [MfaChallenge(jti=uuid.uuid4(), user_id=owners[LIVE_ROWS], expires_at=now - timedelta(minutes=1))])


async def _seed_oidc_authorization_requests() -> None:
    now = datetime.now(UTC)
    provider = OidcProvider(
        slug="test",
        display_name="Test IdP",
        issuer="https://idp.example.com",
        client_id="client",
        client_secret_encrypted=encrypt("secret"),
        scopes="openid",
        enabled=True,
    )
    await _save([provider])

    def request(state_hash: str, expires_at: datetime) -> OidcAuthorizationRequest:
        return OidcAuthorizationRequest(state_hash=state_hash, nonce="n", code_verifier="v", provider_id=provider.id, expires_at=expires_at)

    live = [request(f"live{index}", now + timedelta(minutes=5)) for index in range(LIVE_ROWS)]
    await _save(live, [request("expired", now - timedelta(minutes=1))])


async def _seed_password_reset_tokens() -> None:
    owners, now = await _seed_crowd(), datetime.now(UTC)

    def token(owner: uuid.UUID, token_hash: str, age: timedelta) -> PasswordResetToken:
        return PasswordResetToken(user_id=owner, token_hash=token_hash, expires_at=now, created_at=now - age)

    live = [token(owner, f"live{index}", timedelta(hours=1)) for index, owner in enumerate(owners[:LIVE_ROWS])]
    await _save(live, [token(owners[LIVE_ROWS], "stale", timedelta(hours=25))])


async def _seed_email_change_requests() -> None:
    owners, now = await _seed_crowd(), datetime.now(UTC)

    def request(owner: uuid.UUID, token_hash: str, expires_at: datetime) -> EmailChangeRequest:
        return EmailChangeRequest(user_id=owner, new_email=f"{token_hash}@example.org", token_hash=token_hash, expires_at=expires_at)

    live = [request(owner, f"live{index}", now + timedelta(minutes=5)) for index, owner in enumerate(owners[:LIVE_ROWS])]
    await _save(live, [request(owners[LIVE_ROWS], "expired", now - timedelta(minutes=1))])


async def _seed_login_lockouts() -> None:
    now = datetime.now(UTC)
    live = [LoginLockout(email_hash=f"live{index}", bucket_hash="", failed_attempt_count=1, last_failed_at=now) for index in range(LIVE_ROWS)]
    await _save(live, [LoginLockout(email_hash="idle", bucket_hash="", failed_attempt_count=1, last_failed_at=now - timedelta(days=8))])


async def _seed_signup_email_sends() -> None:
    now = datetime.now(UTC)
    live = [SignupEmailSend(email_hash=f"live{index}", created_at=now - timedelta(hours=1)) for index in range(LIVE_ROWS)]
    await _save(live, [SignupEmailSend(email_hash="stale", created_at=now - timedelta(hours=25))])


async def _seed_factor_staging() -> None:
    """Seed confirmed and active factors old enough to be stale if they were staged, beside one staged of each kind"""
    owners, now = await _seed_crowd(), datetime.now(UTC)
    old = now - timedelta(days=1)
    kept, staged_owner = owners[:LIVE_ROWS], owners[LIVE_ROWS]
    passkeys = [
        WebauthnCredential(user_id=owner, credential_id=f"kept{index}".encode(), public_key=b"k", name="Kept", created_at=old, confirmed_at=old)
        for index, owner in enumerate(kept)
    ]
    authenticators = [TotpCredential(user_id=owner, secret_encrypted="s", created_at=old, confirmed_at=old) for owner in kept]
    codes = [RecoveryCode(user_id=owner, code_hash=f"kept{index}", pending=False, created_at=old) for index, owner in enumerate(kept)]
    staged = [
        WebauthnCredential(user_id=staged_owner, credential_id=b"staged", public_key=b"k", name="Staged", created_at=old),
        TotpCredential(user_id=staged_owner, secret_encrypted="s", created_at=old),
        RecoveryCode(user_id=staged_owner, code_hash="staged", pending=True, created_at=old),
    ]
    await _save(passkeys, authenticators, codes, staged)


async def _seed_import_runs() -> None:
    """Seed committed runs uploaded long ago and still undoable, which a test on the upload's age alone would remove"""
    (owner,) = await _seed_numbered_users(1)
    now = datetime.now(UTC)
    committed = [_import_run(owner, created_at=now - LONG_AGO, committed_at=now - timedelta(hours=1)) for _ in range(LIVE_ROWS)]
    await _save(committed, [_import_run(owner, created_at=now - LONG_AGO)])


async def _seed_bank_sync_jobs() -> None:
    owners, now = await _seed_crowd(), datetime.now(UTC)
    connection = _build_bank_connection(owners[0])
    await _save([connection])

    def finished(finished_at: datetime) -> BankSyncJob:
        return BankSyncJob(
            owner_id=owners[0],
            connection_id=connection.id,
            kind=BankSyncJobKind.SCHEDULED,
            status=BankSyncJobStatus.SUCCEEDED,
            attempt=1,
            finished_at=finished_at,
        )

    live = [finished(now - timedelta(days=1)) for _ in range(LIVE_ROWS)]
    await _save(live, [finished(now - timedelta(days=31))])


async def _seed_bank_authorizations() -> None:
    owners, now = await _seed_crowd(), datetime.now(UTC)

    def sign_in(owner: uuid.UUID, state: str, expires_at: datetime) -> BankAuthorization:
        return BankAuthorization(
            owner_id=owner, provider="signin_bank", credentials_encrypted=encrypt("{}"), state_hash=state, expires_at=expires_at
        )

    live = [sign_in(owner, f"live{index}", now + timedelta(minutes=5)) for index, owner in enumerate(owners[:LIVE_ROWS])]
    await _save(live, [sign_in(owners[LIVE_ROWS], "expired", now - timedelta(minutes=1))])


# Keyed by kind name, so a kind added to the cleanup without a case here fails its test
_ROWS_READ_CASES = {
    "auth sessions": _RowsReadCase(_seed_auth_sessions, {"auth_sessions": 1}),
    "auth tokens": _RowsReadCase(_seed_auth_tokens, {"auth_tokens": 2}),
    "passkey challenges": _RowsReadCase(_seed_passkey_challenges, {"webauthn_challenges": 1}),
    "MFA challenges": _RowsReadCase(_seed_mfa_challenges, {"mfa_challenges": 1}),
    "OIDC authorization requests": _RowsReadCase(_seed_oidc_authorization_requests, {"oidc_authorization_requests": 1}),
    "password reset tokens": _RowsReadCase(_seed_password_reset_tokens, {"password_reset_tokens": 1}),
    "email change requests": _RowsReadCase(_seed_email_change_requests, {"email_change_requests": 1}),
    "idle sign-in lockouts": _RowsReadCase(_seed_login_lockouts, {"login_lockouts": 1}),
    "sign-up email records": _RowsReadCase(_seed_signup_email_sends, {"signup_email_sends": 1}),
    "two-factor staging": _RowsReadCase(_seed_factor_staging, {"webauthn_credentials": 1, "totp_credentials": 1, "recovery_codes": 1}),
    "import runs": _RowsReadCase(_seed_import_runs, {"import_runs": 1}),
    "finished bank sync jobs": _RowsReadCase(_seed_bank_sync_jobs, {"bank_sync_jobs": 1}),
    "bank sign-ins": _RowsReadCase(_seed_bank_authorizations, {"bank_authorizations": 1}),
}


def test_every_kind_of_expired_record_has_a_rows_read_case():
    """A kind added to the cleanup gets a case below, and a case for a kind that is gone is dropped"""
    assert set(_ROWS_READ_CASES) == {kind.name for kind in expired_records.EXPIRED_RECORD_KINDS}


@pytest.mark.parametrize("kind", expired_records.EXPIRED_RECORD_KINDS, ids=lambda kind: kind.name)
async def test_pruning_a_kind_reads_only_its_expired_rows(kind):
    """Each kind's cleanup finds its expired rows by an index, so the rows it keeps are never read

    The rows that stay are many, and are the ones the filter has to pass over: live ones, and old ones
    that a condition other than age keeps. The cleanup runs for real and its rows read are counted
    before anything commits
    """
    case = _ROWS_READ_CASES[kind.name]
    await case.seed()

    async with ScopedSession() as session:
        await _avoid_full_scans(session)
        await kind.delete_expired(session)
        rows_read = {table: await _rows_read(session, table) for table in case.expired_rows}

    for table, expired in case.expired_rows.items():
        assert rows_read[table] >= expired, f"read {rows_read[table]} rows of {table}, so it never found its {expired} expired"
        assert rows_read[table] < expired + SLACK, f"read {rows_read[table]} rows of {table} to remove {expired}"
