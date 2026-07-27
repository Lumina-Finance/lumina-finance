"""Alembic schema parity tests"""

import os
import subprocess
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import Enum as SqlaEnum
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from app.config.database import MIGRATOR_DB_USER
from app.models.base import Base
from tests.conftest import (
    DB_HOST,
    DB_PASSWORD,
    DB_PORT,
    DB_USER,
    WORKER_DB_NAME,
)

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_TEST_DB_NAME = f"{WORKER_DB_NAME}_alembic_schema"
_ALEMBIC_ENUM_DB_NAME = f"{WORKER_DB_NAME}_alembic_enums"
_ALEMBIC_AUTH_RESET_DB_NAME = f"{WORKER_DB_NAME}_alembic_auth_reset"
_AUTH_SESSIONS_REVISION = "a4f8d1c2e7b3"


async def test_alembic_schema_columns_match_model_metadata() -> None:
    """Verify Alembic creates the same table columns expected by the models"""
    await _recreate_database(_ALEMBIC_TEST_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_TEST_DB_NAME)
        actual_columns = await _get_database_columns(_ALEMBIC_TEST_DB_NAME)
        expected_columns = _get_model_columns()
        assert actual_columns == expected_columns
    finally:
        await _drop_database(_ALEMBIC_TEST_DB_NAME)


async def test_alembic_enum_labels_match_model_metadata() -> None:
    """Verify Alembic builds the same enum labels the models declare

    The route tests build the schema from model metadata, so a model enum that gains a value with no
    migration to add it still passes there yet breaks a migration-built database. Comparing the two
    directly catches that drift, such as a new auth provider added to the type without a migration
    """
    await _recreate_database(_ALEMBIC_ENUM_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_ENUM_DB_NAME)
        actual_enums = await _get_database_enums(_ALEMBIC_ENUM_DB_NAME)
        expected_enums = _get_model_enums()
        assert actual_enums == expected_enums
    finally:
        await _drop_database(_ALEMBIC_ENUM_DB_NAME)


async def test_auth_session_overhaul_clears_legacy_auth_state() -> None:
    """Verify the auth-token migration does not carry old sessions forward"""
    await _recreate_database(_ALEMBIC_AUTH_RESET_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_AUTH_RESET_DB_NAME, revision=_AUTH_SESSIONS_REVISION)
        await _seed_legacy_auth_state(_ALEMBIC_AUTH_RESET_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_AUTH_RESET_DB_NAME)

        session_count, token_count, active_tokens_exists = await _get_auth_storage_state(
            _ALEMBIC_AUTH_RESET_DB_NAME,
        )
        assert session_count == 0
        assert token_count == 0
        assert not active_tokens_exists
    finally:
        await _drop_database(_ALEMBIC_AUTH_RESET_DB_NAME)


async def _recreate_database(database_name: str) -> None:
    """Drop and recreate the database used for Alembic schema parity"""
    maintenance_engine = _create_engine_for_database("postgres", isolation_level="AUTOCOMMIT")
    try:
        async with maintenance_engine.connect() as conn:
            await _terminate_database_connections(conn, database_name)

            # Drop any stale parity database left by an interrupted test run
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))

            # Create a clean database owned by the migrator, since Alembic runs as
            # the migrator and must own the schema it builds from the base revision
            await conn.execute(text(f'CREATE DATABASE "{database_name}" OWNER "{MIGRATOR_DB_USER}"'))
    finally:
        await maintenance_engine.dispose()


async def _drop_database(database_name: str) -> None:
    """Drop the database used for Alembic schema parity"""
    maintenance_engine = _create_engine_for_database("postgres", isolation_level="AUTOCOMMIT")
    try:
        async with maintenance_engine.connect() as conn:
            await _terminate_database_connections(conn, database_name)

            # Drop the parity database so repeated test runs start clean
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
    finally:
        await maintenance_engine.dispose()


async def _terminate_database_connections(conn: AsyncConnection, database_name: str) -> None:
    """Terminate open connections to a generated parity database"""
    # Close active connections so PostgreSQL can drop the generated database
    await conn.execute(
        text(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = :database_name
              AND pid <> pg_backend_pid()
            """,
        ),
        {"database_name": database_name},
    )


def _run_alembic_upgrade(database_name: str, *, revision: str = "head") -> None:
    """Run Alembic upgrade against a generated parity database"""
    environment = os.environ.copy()
    environment.update(
        {
            "DB_HOST": DB_HOST,
            "DB_PORT": DB_PORT,
            "DB_NAME": database_name,
            "DB_USER": DB_USER,
            "DB_PASSWORD": DB_PASSWORD,
        },
    )

    # Alembic revisions are fixed test constants, and subprocess keeps migration imports isolated
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


async def _seed_legacy_auth_state(database_name: str) -> None:
    """Insert old auth rows that the overhaul migration should discard"""
    user_id = UUID("11111111-1111-4111-8111-111111111111")
    session_id = UUID("22222222-2222-4222-8222-222222222222")
    token_id = UUID("33333333-3333-4333-8333-333333333333")

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:

            # Seed the user dependency needed by legacy auth rows
            await conn.execute(
                text(
                    """
                    INSERT INTO currencies (id, name, symbol, minor_unit_exponent)
                    VALUES ('CAD', 'Canadian Dollar', '$', 2)
                    """,
                ),
            )

            # Seed a user so legacy auth rows are valid before the migration runs
            await conn.execute(
                text(
                    """
                    INSERT INTO users (id, email, first_name, tz, base_currency)
                    VALUES (:user_id, 'migration-auth-reset@example.com', 'Migration', 'America/Toronto', 'CAD')
                    """,
                ),
                {"user_id": user_id},
            )

            # Seed the old session row that should force the user to log in again
            await conn.execute(
                text(
                    """
                    INSERT INTO auth_sessions (id, user_id, expires_at)
                    VALUES (:session_id, :user_id, now() + interval '1 day')
                    """,
                ),
                {"session_id": session_id, "user_id": user_id},
            )

            # Seed the old token row that should be removed with the legacy table
            await conn.execute(
                text(
                    """
                    INSERT INTO active_tokens (jti, user_id, session_id, expires_at)
                    VALUES (:token_id, :user_id, :session_id, now() + interval '1 day')
                    """,
                ),
                {"token_id": token_id, "user_id": user_id, "session_id": session_id},
            )
    finally:
        await engine.dispose()


async def _get_auth_storage_state(database_name: str) -> tuple[int, int, bool]:
    """Return auth storage row counts after the overhaul migration"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:

            # Count remaining sessions to verify pre-overhaul login state was discarded
            session_count = await conn.scalar(text("SELECT count(*) FROM auth_sessions"))

            # Count token allowlist rows to verify no token rows exist after upgrade
            token_count = await conn.scalar(text("SELECT count(*) FROM auth_tokens"))

            # Check the legacy table is gone so old active token rows cannot survive
            active_tokens_exists = await conn.scalar(
                text("SELECT to_regclass('public.active_tokens') IS NOT NULL"),
            )
            return int(session_count or 0), int(token_count or 0), bool(active_tokens_exists)
    finally:
        await engine.dispose()


async def _get_database_columns(database_name: str) -> dict[str, set[str]]:
    """Return public table columns from a generated parity database"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:

            # Fetch public schema columns created by Alembic for comparison with model metadata
            result = await conn.execute(
                text(
                    """
                    SELECT table_name, column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name <> 'alembic_version'
                    ORDER BY table_name, ordinal_position
                    """,
                ),
            )
            columns_by_table: dict[str, set[str]] = {}
            for row in result:
                columns_by_table.setdefault(row.table_name, set()).add(row.column_name)
            return columns_by_table
    finally:
        await engine.dispose()


def _get_model_columns() -> dict[str, set[str]]:
    """Return SQLAlchemy model columns keyed by table name"""
    columns_by_table = {
        table.name: {column.name for column in table.columns}
        for table in Base.metadata.sorted_tables
    }
    return columns_by_table


async def _get_database_enums(database_name: str) -> dict[str, set[str]]:
    """Return enum type labels from a generated parity database, keyed by type name"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:

            # Fetch every public enum type and its labels created by Alembic
            result = await conn.execute(
                text(
                    """
                    SELECT t.typname AS type_name, e.enumlabel AS label
                    FROM pg_type t
                    JOIN pg_enum e ON e.enumtypid = t.oid
                    JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE n.nspname = 'public'
                    """,
                ),
            )
            labels_by_type: dict[str, set[str]] = {}
            for row in result:
                labels_by_type.setdefault(row.type_name, set()).add(row.label)
            return labels_by_type
    finally:
        await engine.dispose()


def _get_model_enums() -> dict[str, set[str]]:
    """Return SQLAlchemy model enum labels keyed by type name, deduped across columns"""
    labels_by_type: dict[str, set[str]] = {}
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, SqlaEnum):
                labels_by_type[column.type.name] = set(column.type.enums)
    return labels_by_type


def _create_engine_for_database(database_name: str, *, isolation_level: str | None = None):
    """Create an async engine for a test database"""
    database_url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{database_name}"
    engine = create_async_engine(database_url, poolclass=NullPool, isolation_level=isolation_level)
    return engine
