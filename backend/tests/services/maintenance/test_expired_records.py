import asyncio
import logging
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.config.imports import ABANDONED_RUN_AGE, IMPORT_UNDO_WINDOW
from app.config.two_factor import TWO_FACTOR_STAGING_EXPIRE_SECONDS
from app.encryption import encrypt
from app.models.auth import (
    MfaChallenge,
    PasswordResetToken,
    RecoveryCode,
    TotpCredential,
    WebauthnChallenge,
    WebauthnCredential,
)
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken, AuthTokenKind
from app.models.currency import Currency
from app.models.import_run import ImportRun, ImportRunSource
from app.models.oidc import OidcAuthorizationRequest, OidcProvider
from app.models.user import User
from app.services.maintenance import expired_records
from app.services.maintenance.expired_records import ExpiredRecordKind, prune_expired_records
from tests.conftest import ScopedSession, TestSession

_NOW = datetime.now(UTC)
_PAST = _NOW - timedelta(minutes=1)
_FUTURE = _NOW + timedelta(hours=1)
_STAGING_EXPIRED = _NOW - timedelta(seconds=TWO_FACTOR_STAGING_EXPIRE_SECONDS + 60)


async def _seed_users(count: int) -> list[User]:
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
    first, second = await _seed_users(2)
    provider = OidcProvider(
        slug="test",
        display_name="Test IdP",
        issuer="https://idp.example.com",
        client_id="client",
        client_secret_encrypted=encrypt("secret"),
        scopes="openid email",
        enabled=True,
    )
    expired_session = AuthSession(user_id=first.id, expires_at=_PAST)
    live_session = AuthSession(user_id=second.id, expires_at=_FUTURE)
    async with TestSession() as session:
        session.add_all([provider, expired_session, live_session])
        await session.flush()
        expired_token = AuthToken(
            jti=uuid.uuid4(),
            user_id=second.id,
            session_id=live_session.id,
            token_kind=AuthTokenKind.REFRESH,
            expires_at=_PAST,
        )
        live_token = AuthToken(
            jti=uuid.uuid4(),
            user_id=second.id,
            session_id=live_session.id,
            token_kind=AuthTokenKind.ACCESS,
            expires_at=_FUTURE,
        )
        expired_passkey_challenge = WebauthnChallenge(challenge=b"old", user_id=first.id, purpose="registration", expires_at=_PAST)
        live_passkey_challenge = WebauthnChallenge(challenge=b"new", purpose="authentication", expires_at=_FUTURE)
        expired_mfa = MfaChallenge(jti=uuid.uuid4(), user_id=first.id, expires_at=_PAST)
        live_mfa = MfaChallenge(jti=uuid.uuid4(), user_id=second.id, expires_at=_FUTURE)
        expired_oidc = OidcAuthorizationRequest(
            state_hash="old",
            nonce="n",
            code_verifier="v",
            provider_id=provider.id,
            expires_at=_PAST,
        )
        live_oidc = OidcAuthorizationRequest(
            state_hash="new",
            nonce="n",
            code_verifier="v",
            provider_id=provider.id,
            expires_at=_FUTURE,
        )
        stale_reset = PasswordResetToken(
            user_id=first.id,
            token_hash="old",
            expires_at=_PAST,
            created_at=_NOW - timedelta(hours=25),
        )
        recent_reset = PasswordResetToken(
            user_id=second.id,
            token_hash="new",
            expires_at=_PAST,
            created_at=_NOW - timedelta(hours=23),
        )
        stale_passkey = WebauthnCredential(
            user_id=first.id,
            credential_id=b"stale",
            public_key=b"k",
            name="Stale",
            created_at=_STAGING_EXPIRED,
        )
        confirmed_passkey = WebauthnCredential(
            user_id=second.id,
            credential_id=b"kept",
            public_key=b"k",
            name="Kept",
            created_at=_STAGING_EXPIRED,
            confirmed_at=_STAGING_EXPIRED,
        )
        stale_totp = TotpCredential(user_id=first.id, secret_encrypted="s", created_at=_STAGING_EXPIRED)
        confirmed_totp = TotpCredential(
            user_id=second.id,
            secret_encrypted="s",
            created_at=_STAGING_EXPIRED,
            confirmed_at=_STAGING_EXPIRED,
        )
        stale_code = RecoveryCode(user_id=first.id, code_hash="stale", pending=True, created_at=_STAGING_EXPIRED)
        active_code = RecoveryCode(user_id=second.id, code_hash="kept", pending=False, created_at=_STAGING_EXPIRED)
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
    assert await _remaining_ids(WebauthnCredential) == {confirmed_passkey.id}
    assert await _remaining_ids(TotpCredential, "user_id") == {second.id}
    assert await _remaining_ids(RecoveryCode) == {active_code.id}


async def test_prunes_abandoned_and_undo_expired_import_runs_for_every_user():
    """Abandoned uploads and runs past their undo window go, while runs still in use stay"""
    first, second = await _seed_users(2)
    long_ago = _NOW - max(ABANDONED_RUN_AGE, IMPORT_UNDO_WINDOW) - timedelta(hours=1)
    abandoned = _import_run(first, created_at=_NOW - ABANDONED_RUN_AGE - timedelta(minutes=1))
    undo_expired = _import_run(second, created_at=long_ago, committed_at=_NOW - IMPORT_UNDO_WINDOW - timedelta(minutes=1))
    in_progress = _import_run(first, created_at=_NOW - ABANDONED_RUN_AGE + timedelta(minutes=5))
    # Uploaded long ago but committed recently, so it is still inside its undo window
    still_undoable = _import_run(second, created_at=long_ago, committed_at=_NOW - IMPORT_UNDO_WINDOW + timedelta(minutes=5))
    async with TestSession() as session:
        session.add_all([abandoned, undo_expired, in_progress, still_undoable])
        await session.commit()

    await prune_expired_records(ScopedSession)

    assert await _remaining_ids(ImportRun) == {in_progress.id, still_undoable.id}


async def test_a_failing_kind_is_logged_and_the_kinds_around_it_still_commit(monkeypatch, caplog):
    """A cleanup that fails mid-statement is logged, and neither the kind before nor after it is lost"""
    (owner,) = await _seed_users(1)
    expired_mfa = MfaChallenge(jti=uuid.uuid4(), user_id=owner.id, expires_at=_PAST)
    expired_passkey_challenge = WebauthnChallenge(challenge=b"old", purpose="authentication", expires_at=_PAST)
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


async def test_the_schedule_keeps_pruning_until_cancelled(monkeypatch):
    """The server loop prunes again after each interval rather than once"""
    runs = 0
    second_run = asyncio.Event()

    async def count_run():
        nonlocal runs
        runs += 1
        if runs == 2:
            second_run.set()

    monkeypatch.setattr(expired_records, "prune_expired_records", count_run)
    monkeypatch.setattr(expired_records, "EXPIRED_RECORD_PRUNE_INTERVAL", timedelta(0))

    schedule = asyncio.create_task(expired_records.prune_expired_records_on_schedule())
    await asyncio.wait_for(second_run.wait(), timeout=5)
    schedule.cancel()
    with suppress(asyncio.CancelledError):
        await schedule
