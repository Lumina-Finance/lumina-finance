"""Index parity between the migrations and the models

The other tests build the schema from the models, so an index only a migration creates would never
exist for them, and one only a model declares would never reach a deployed database. Comparing the
definitions of both catches either, and a missing one is a cleanup that reads whole tables
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from tests.conftest import WORKER_DB_NAME, engine
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic, _run_alembic_upgrade

_INDEX_PARITY_DB_NAME = f"{WORKER_DB_NAME}_alembic_index_parity"
_BEFORE_CLEANUP_INDEXES_REVISION = "7f3c2a9e4b51"
_CLEANUP_INDEXES_REVISION = "c91e4a7b3d25"

# The tables the cleanup indexes are on. Comparing every table fails today on the names of three
# primary keys, two of the tax advantaged tables' and the migration history's. That drift is older
_CLEANUP_TABLES = (
    "auth_sessions",
    "auth_tokens",
    "webauthn_challenges",
    "mfa_challenges",
    "oidc_authorization_requests",
    "bank_authorizations",
    "login_lockouts",
    "signup_email_sends",
    "webauthn_credentials",
    "totp_credentials",
    "recovery_codes",
    "import_runs",
    "bank_sync_jobs",
)


async def _index_definitions(conn: AsyncConnection, tables: tuple[str, ...] | None = None) -> dict[str, str]:
    """Return each index's definition by name, for every table or only the given ones"""
    rows = await conn.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND (:all OR tablename = ANY(:tables))"),
        {"all": tables is None, "tables": list(tables or ())},
    )
    return dict(rows.all())


async def test_indexes_built_by_the_migrations_match_those_the_models_declare():
    """On the tables the cleanups use, a deployed database has the indexes the tests' models build, and no others"""
    await _recreate_database(_INDEX_PARITY_DB_NAME)
    migrated_engine = _create_engine_for_database(_INDEX_PARITY_DB_NAME)
    try:
        _run_alembic_upgrade(_INDEX_PARITY_DB_NAME)
        async with migrated_engine.connect() as conn:
            migrated = await _index_definitions(conn, _CLEANUP_TABLES)
        async with engine.connect() as conn:
            declared = await _index_definitions(conn, _CLEANUP_TABLES)
    finally:
        await migrated_engine.dispose()
        await _drop_database(_INDEX_PARITY_DB_NAME)

    assert migrated == declared


async def test_downgrading_the_cleanup_indexes_drops_them_and_upgrading_restores_them():
    """The downgrade removes exactly the indexes the upgrade added, and no data or other index goes with them"""
    await _recreate_database(_INDEX_PARITY_DB_NAME)
    migrated_engine = _create_engine_for_database(_INDEX_PARITY_DB_NAME)
    try:
        _run_alembic_upgrade(_INDEX_PARITY_DB_NAME, revision=_BEFORE_CLEANUP_INDEXES_REVISION)
        async with migrated_engine.connect() as conn:
            before = await _index_definitions(conn)

        _run_alembic_upgrade(_INDEX_PARITY_DB_NAME, revision=_CLEANUP_INDEXES_REVISION)
        async with migrated_engine.connect() as conn:
            upgraded = await _index_definitions(conn)

        downgrade = _run_alembic(_INDEX_PARITY_DB_NAME, "downgrade", _BEFORE_CLEANUP_INDEXES_REVISION)
        assert downgrade.returncode == 0, downgrade.stdout + downgrade.stderr
        async with migrated_engine.connect() as conn:
            downgraded = await _index_definitions(conn)

        _run_alembic_upgrade(_INDEX_PARITY_DB_NAME, revision=_CLEANUP_INDEXES_REVISION)
        async with migrated_engine.connect() as conn:
            reupgraded = await _index_definitions(conn)
    finally:
        await migrated_engine.dispose()
        await _drop_database(_INDEX_PARITY_DB_NAME)

    assert len(upgraded) > len(before), "the upgrade adds indexes"
    assert downgraded == before
    assert reupgraded == upgraded
