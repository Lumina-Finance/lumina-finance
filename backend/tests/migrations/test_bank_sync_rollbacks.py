"""Bank sync migration rollbacks refuse while their tables hold data

Dropping a bank sync table would delete stored credentials, links and decisions that nothing can
rebuild, so each downgrade refuses while its tables hold a row, names what would be lost, and
drops them once they are empty. Seeding is plain SQL, so a later change to a model can't break
the insert into a database built only up to the revision under test
"""

from uuid import UUID

import pytest
from sqlalchemy import text

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import (
    _create_engine_for_database,
    _drop_database,
    _recreate_database,
    _run_alembic,
    _run_alembic_upgrade,
)

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_rollback"
# Every statement may name these, so rows can point at each other across statements
_IDS = {
    "user_id": UUID("11111111-1111-4111-8111-111111111111"),
    "account_id": UUID("22222222-2222-4222-8222-222222222222"),
    "connection_id": UUID("33333333-3333-4333-8333-333333333333"),
}

# The user and account every seeded row hangs from
_OWNER = (
    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO users (id, email, first_name, tz, base_currency) "
    "VALUES (:user_id, 'rollback@example.com', 'Rollback', 'America/Toronto', 'CAD')",
    "INSERT INTO accounts (id, owner_id, account_kind, account_type, name, currency, is_archived) "
    "VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Everyday', 'CAD', false)",
)
_CONNECTION = (
    "INSERT INTO bank_connections (id, owner_id, provider, credential_encrypted, server_host) "
    "VALUES (:connection_id, :user_id, 'simplefin', 'not-a-real-token', 'bridge.example')"
)

# Each revision, a row in one of its tables, the table to empty afterwards, and how the refusal
# names what the row is
_ROLLBACKS = [
    pytest.param("5b8e2d4f7a13", (_CONNECTION,), "bank_connections", "bank connections", id="connections"),
    pytest.param(
        "9d2c6e1a4b58",
        ("INSERT INTO account_review_preferences (account_id, owner_id) VALUES (:account_id, :user_id)",),
        "account_review_preferences",
        "the review preferences",
        id="review_preferences",
    ),
]


async def _execute(database_name: str, statements: tuple[str, ...]) -> int:
    """Run statements against a generated database in one transaction

    Returns:
        How many rows the last statement touched
    """
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as connection:
            for statement in statements:
                result = await connection.execute(text(statement), _IDS)
            return result.rowcount
    finally:
        await engine.dispose()


@pytest.mark.parametrize(("revision", "seed", "table", "loss"), _ROLLBACKS)
async def test_bank_sync_rollback_while_its_tables_hold_rows_is_refused(revision, seed, table, loss):
    """The downgrade names what it would delete and keeps it, then succeeds once emptied"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=revision)
        await _execute(_DATABASE_NAME, _OWNER + seed)

        refused = _run_alembic(_DATABASE_NAME, "downgrade", "-1")

        assert refused.returncode != 0
        assert f"Refusing to roll back: it would delete {loss}" in refused.stderr

        # The seeded row is still there to delete, so the refusal kept it
        assert await _execute(_DATABASE_NAME, (f"DELETE FROM {table}",)) == 1  # noqa: S608
        emptied = _run_alembic(_DATABASE_NAME, "downgrade", "-1")
        assert emptied.returncode == 0, emptied.stdout + emptied.stderr

        # The tables come back the way they went, so the rollback is a true inverse
        _run_alembic_upgrade(_DATABASE_NAME, revision=revision)
    finally:
        await _drop_database(_DATABASE_NAME)
