"""Shared helpers for tests that build a database through Alembic

Each test builds its own database rather than reusing the worker's. The test harness creates that one
from the model metadata, so what these tests see is what the migrations actually build
"""

import hashlib
import hmac
import os
import subprocess
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from app.config.database import MIGRATOR_DB_USER
from tests.conftest import DB_HOST, DB_PASSWORD, DB_PORT, DB_USER

_BACKEND_DIR = Path(__file__).resolve().parents[2]

# The revision before the one that replaces each saved bank sync transaction ID with its keyed hash
BEFORE_BANK_SYNC_ID_HASH_REVISION = "8d86357d118a"
BANK_SYNC_ID_HASH_REVISION = "a2d7f4c8e1b6"

BANK_SYNC_IDS = {
    "user_id": UUID("11111111-1111-4111-8111-111111111111"),
    "account_id": UUID("22222222-2222-4222-8222-222222222222"),
}

# Saved bank sync records as a database one revision before the hash holds them. Plain SQL, so a later
# change to a model can't break the insert into a database built only up to that revision
BANK_SYNC_SEED = (
    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO users (id, email, first_name, tz, base_currency) VALUES (:user_id, 'hash@example.com', 'Hash', 'America/Toronto', 'CAD')",
    "INSERT INTO accounts (id, owner_id, account_kind, account_type, name, currency, is_archived) "
    "VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Everyday', 'CAD', false)",
    "INSERT INTO bank_transactions "
    "(id, owner_id, account_id, provider, external_account_id, external_transaction_id, disposition, observed_date, observed_amount, "
    "description, merchant_name, category_hint, extras, observed_at) "
    "VALUES (gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', 'TRN-coffee', 'awaiting_review', '2026-10-02', -450, "
    "'POS 4411 COFFEE', 'Corner Coffee', 'Dining', '{\"memo\": \"latte\"}', now())",
    # A dismissed record keeps only its identity, so the hash must carry that alone
    "INSERT INTO bank_transactions (id, owner_id, account_id, provider, external_account_id, external_transaction_id, disposition) "
    "VALUES (gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', 'TRN-refund', 'dismissed')",
    "INSERT INTO bank_pending_transactions "
    "(id, owner_id, account_id, external_transaction_id, transaction_date, amount, description, observed_at) "
    "VALUES (gen_random_uuid(), :user_id, :account_id, 'P-1', '2026-10-04', -2500, 'HOLD', now())",
)


def expected_bank_sync_hash(key: bytes, external_account_id: str, external_transaction_id: str) -> str:
    """Return the hash the server keeps under a key for a SimpleFIN transaction, worked out here from its definition

    HMAC-SHA256 under the key of the SHA-256 digest over the provider and bank account, a zero byte and
    the transaction ID
    """
    digest = hashlib.sha256(f"simplefin:{external_account_id}".encode() + b"\0" + external_transaction_id.encode()).digest()
    return hmac.new(key, digest, hashlib.sha256).hexdigest()


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
    # Close active connections so PostgreSQL can drop the generated database. Only client
    # connections are ended here: an autovacuum worker runs as a superuser. The test role
    # may not terminate it, and DROP DATABASE stops one by itself
    await conn.execute(
        text(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = :database_name
              AND pid <> pg_backend_pid()
              AND backend_type = 'client backend'
            """,
        ),
        {"database_name": database_name},
    )


def _run_alembic(database_name: str, command: str, revision: str) -> subprocess.CompletedProcess[str]:
    """Run one Alembic command against a generated database and return how it ended

    Args:
        database_name: Database the command runs against
        command: upgrade or downgrade
        revision: Target revision, relative steps included

    Returns:
        The finished process, so a test expecting a refusal can read its output
    """
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
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", command, revision],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )


def _run_alembic_upgrade(database_name: str, *, revision: str = "head") -> None:
    """Run Alembic upgrade against a generated parity database"""
    completed = _run_alembic(database_name, "upgrade", revision)
    assert completed.returncode == 0, completed.stdout + completed.stderr


def _create_engine_for_database(database_name: str, *, isolation_level: str | None = None):
    """Create an async engine for a test database"""
    database_url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{database_name}"
    engine = create_async_engine(database_url, poolclass=NullPool, isolation_level=isolation_level)
    return engine
