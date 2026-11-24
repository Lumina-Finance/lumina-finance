"""The last sign-in migration fills each user's time from the sign-ins the database still holds, and its rollback drops the table

Seeding is plain SQL, so a later change to a model can't break the insert into a database built only up
to the revision before the one under test
"""

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import text

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic, _run_alembic_upgrade

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_last_sign_in"
_REVISION = "b4c8e2a6d1f3"
_PREVIOUS_REVISION = "e6b2d9f4a1c7"
_RENEWING = UUID("11111111-1111-4111-8111-111111111111")
_PROVIDER_ONLY = UUID("22222222-2222-4222-8222-222222222222")
_NO_RECORD = UUID("33333333-3333-4333-8333-333333333333")
_SESSION_ONLY = UUID("66666666-6666-4666-8666-666666666666")
_PASSKEY_ONLY = UUID("88888888-8888-4888-8888-888888888888")
_PASSKEY_USED = datetime(2026, 1, 15, 12, 0, tzinfo=UTC)
_SESSION = UUID("44444444-4444-4444-8444-444444444444")
_TOKENLESS_SESSION = UUID("77777777-7777-4777-8777-777777777777")
_SESSION_STARTED = datetime(2026, 3, 1, 14, 0, tzinfo=UTC)
_TOKENLESS_STARTED = datetime(2026, 3, 5, 18, 0, tzinfo=UTC)
_RENEWED = datetime(2026, 3, 20, 9, 30, tzinfo=UTC)
_PROVIDER_SIGN_IN = datetime(2026, 2, 10, 8, 0, tzinfo=UTC)

# A user who signed in through a provider in February, started a session on 1 March and renewed it on
# 20 March, one whose only trace is a provider sign-in, one whose only trace is a session with no token
# left, one whose only trace is a passkey's last use, and one with no trace at all
_SEED = (
    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO users (id, email, first_name, tz, base_currency) VALUES "
    "(:renewing, 'renewing@example.com', 'Renewing', 'America/Toronto', 'CAD'), "
    "(:provider_only, 'provider@example.com', 'Provider', 'America/Toronto', 'CAD'), "
    "(:session_only, 'session@example.com', 'Session', 'America/Toronto', 'CAD'), "
    "(:passkey_only, 'passkey@example.com', 'Passkey', 'America/Toronto', 'CAD'), "
    "(:no_record, 'quiet@example.com', 'Quiet', 'America/Toronto', 'CAD')",
    "INSERT INTO auth_sessions (id, user_id, expires_at, created_at) VALUES "
    "(:session, :renewing, CAST(:renewed AS timestamptz) + interval '30 days', :started), "
    "(:tokenless_session, :session_only, CAST(:tokenless_started AS timestamptz) + interval '30 days', :tokenless_started)",
    # The token the renewal replaced keeps a grace time, as a rotated token does
    "INSERT INTO auth_tokens (jti, user_id, session_id, token_kind, expires_at, refresh_grace_expires_at, created_at) VALUES "
    "(gen_random_uuid(), :renewing, :session, 'REFRESH', CAST(:renewed AS timestamptz) + interval '30 days', :renewed, :started), "
    "(gen_random_uuid(), :renewing, :session, 'REFRESH', CAST(:renewed AS timestamptz) + interval '30 days', NULL, :renewed)",
    "INSERT INTO oidc_providers (id, slug, display_name, issuer, client_id, client_secret_encrypted, scopes, enabled) VALUES "
    "('55555555-5555-4555-8555-555555555555', 'idp', 'Provider', 'https://idp.example.com', 'client', 'sealed', 'openid email', true)",
    "INSERT INTO oidc_identities (id, user_id, provider_id, subject, email, last_login_at) VALUES "
    "(gen_random_uuid(), :provider_only, '55555555-5555-4555-8555-555555555555', 'provider', 'provider@example.com', :provider_sign_in), "
    "(gen_random_uuid(), :renewing, '55555555-5555-4555-8555-555555555555', 'renewing', 'renewing@example.com', :provider_sign_in)",
    "INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, sign_count, name, confirmed_at, last_used_at) VALUES "
    "(gen_random_uuid(), :passkey_only, '\\x01'::bytea, '\\x02'::bytea, 1, 'Laptop', :passkey_used, :passkey_used)",
)

# Each user's time is the newest of their sources, and the user with none gets no row
_EXPECTED_TIMES = {_RENEWING: _RENEWED, _PROVIDER_ONLY: _PROVIDER_SIGN_IN, _SESSION_ONLY: _TOKENLESS_STARTED, _PASSKEY_ONLY: _PASSKEY_USED}


@pytest.fixture
async def database():
    """A database of its own at the revision before, seeded, and dropped afterwards"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=_PREVIOUS_REVISION)
        engine = _create_engine_for_database(_DATABASE_NAME)
        try:
            async with engine.begin() as conn:
                for statement in _SEED:
                    await conn.execute(
                        text(statement),
                        {
                            "renewing": _RENEWING,
                            "provider_only": _PROVIDER_ONLY,
                            "session_only": _SESSION_ONLY,
                            "passkey_only": _PASSKEY_ONLY,
                            "passkey_used": _PASSKEY_USED,
                            "no_record": _NO_RECORD,
                            "session": _SESSION,
                            "tokenless_session": _TOKENLESS_SESSION,
                            "started": _SESSION_STARTED,
                            "tokenless_started": _TOKENLESS_STARTED,
                            "renewed": _RENEWED,
                            "provider_sign_in": _PROVIDER_SIGN_IN,
                        },
                    )
        finally:
            await engine.dispose()
        yield _DATABASE_NAME
    finally:
        await _drop_database(_DATABASE_NAME)


async def _stored_times(database: str) -> dict[UUID, datetime]:
    """Each user's stored last sign-in"""
    engine = _create_engine_for_database(database)
    try:
        async with engine.connect() as conn:
            rows = (await conn.execute(text("SELECT user_id, last_signed_in_at FROM user_last_sign_ins"))).all()
    finally:
        await engine.dispose()
    return dict(rows)


async def _table_and_list(database: str) -> tuple[bool | None, bool]:
    """Whether the table has row-level security on, None when it doesn't exist, and whether the function listing users exists"""
    engine = _create_engine_for_database(database)
    try:
        async with engine.connect() as conn:
            secured = await conn.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.user_last_sign_ins')"))
            listing = await conn.scalar(text("SELECT to_regprocedure('public.list_users(uuid, integer)') IS NOT NULL"))
    finally:
        await engine.dispose()
    return secured, listing


async def test_upgrade_takes_each_users_newest_sign_in_and_leaves_a_user_with_none_unknown(database):
    """A renewal outranks an older session start and provider sign-in, each source counts alone, and a user with no trace gets no time"""
    _run_alembic_upgrade(database, revision=_REVISION)

    assert await _stored_times(database) == _EXPECTED_TIMES
    assert await _table_and_list(database) == (True, True), "the table is secured and users can be listed"


async def test_downgrade_drops_the_table_and_the_list_and_upgrades_back(database):
    """The rollback removes the table and the function listing users, and the revision applies again with the same times"""
    _run_alembic_upgrade(database, revision=_REVISION)
    downgraded = _run_alembic(database, "downgrade", _PREVIOUS_REVISION)
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr

    assert await _table_and_list(database) == (None, False)

    _run_alembic_upgrade(database, revision=_REVISION)
    assert await _stored_times(database) == _EXPECTED_TIMES
    assert await _table_and_list(database) == (True, True), "upgrading again secures the table and brings the list back"
