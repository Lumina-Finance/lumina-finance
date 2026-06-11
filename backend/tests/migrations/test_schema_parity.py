"""Alembic schema parity tests"""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from app.models.base import Base
from tests.conftest import (
    TEST_DB_HOST,
    TEST_DB_PASSWORD,
    TEST_DB_PORT,
    TEST_DB_USER,
    WORKER_DB_NAME,
)

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_TEST_DB_NAME = f"{WORKER_DB_NAME}_alembic_schema"


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


async def _recreate_database(database_name: str) -> None:
    """Drop and recreate the database used for Alembic schema parity"""
    maintenance_engine = _create_engine_for_database("postgres", isolation_level="AUTOCOMMIT")
    try:
        async with maintenance_engine.connect() as conn:
            await _terminate_database_connections(conn, database_name)

            # Drop any stale parity database left by an interrupted test run
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))

            # Create a clean database that Alembic will build from its base revision
            await conn.execute(text(f'CREATE DATABASE "{database_name}"'))
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


def _run_alembic_upgrade(database_name: str) -> None:
    """Run Alembic upgrade head against a generated parity database"""
    environment = os.environ.copy()
    environment.update(
        {
            "DB_HOST": TEST_DB_HOST,
            "DB_PORT": TEST_DB_PORT,
            "DB_NAME": database_name,
            "DB_USER": TEST_DB_USER,
            "DB_PASSWORD": TEST_DB_PASSWORD,
        },
    )

    completed = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


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


def _create_engine_for_database(database_name: str, *, isolation_level: str | None = None):
    """Create an async engine for a test database"""
    database_url = f"postgresql+asyncpg://{TEST_DB_USER}:{TEST_DB_PASSWORD}@{TEST_DB_HOST}:{TEST_DB_PORT}/{database_name}"
    engine = create_async_engine(database_url, poolclass=NullPool, isolation_level=isolation_level)
    return engine
