"""Bank sync migration rollbacks refuse while their tables hold data, and leave the tables they keep as they found them

Dropping a bank sync table would delete stored credentials, links and decisions that nothing can
rebuild, so each downgrade refuses while its tables hold a row, names what would be lost, and
drops them once they are empty. Seeding is plain SQL, so a later change to a model can't break
the insert into a database built only up to the revision under test. A rollback that drops a
column puts back the checks the column joined, which Postgres would otherwise drop with it
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
    "INSERT INTO bank_connections (id, owner_id, provider, provider_name, credential_encrypted, server_host) "
    "VALUES (:connection_id, :user_id, 'simplefin', 'SimpleFIN', 'not-a-real-token', 'bridge.example')"
)
_CONNECTIONS_REVISION = "5b8e2d4f7a13"

# The functions the sync jobs migration adds for the worker. Its rollback drops them
_WORKER_FUNCTIONS = (
    "claim_bank_sync_jobs",
    "list_due_bank_connections",
    "record_bank_sync_scan",
    "prune_finished_bank_sync_jobs",
    "migration_revisions",
)

# Each revision, the rows seeded into it, the tables to empty afterwards with the one under test
# first, how the refusal names what that table holds, and the functions the rollback drops
_ROLLBACKS = [
    pytest.param(
        _CONNECTIONS_REVISION,
        (_CONNECTION,),
        ("bank_connections",),
        "bank connections and their stored credentials",
        (),
        id="connections",
    ),
    pytest.param(
        _CONNECTIONS_REVISION,
        (
            _CONNECTION,
            "INSERT INTO bank_external_accounts "
            "(id, owner_id, connection_id, external_id, name, institution_key, institution_name, login_key, currency, last_seen_at) "
            "VALUES (gen_random_uuid(), :user_id, :connection_id, 'ACT-1', 'Everyday Chequing', 'harbour', 'Harbour Bank', "
            "'login-1', 'CAD', now())",
        ),
        ("bank_external_accounts", "bank_connections"),
        "the bank accounts connections list",
        (),
        id="external_accounts",
    ),
    pytest.param(
        _CONNECTIONS_REVISION,
        (
            _CONNECTION,
            "INSERT INTO bank_provider_requests (id, owner_id, connection_id, purpose) "
            "VALUES (gen_random_uuid(), :user_id, :connection_id, 'sync')",
        ),
        ("bank_provider_requests", "bank_connections"),
        "the record of provider requests the daily request budget counts",
        (),
        id="provider_requests",
    ),
    # A link outlives its disconnected connection to keep its "Previously linked to" details
    pytest.param(
        _CONNECTIONS_REVISION,
        (
            "INSERT INTO bank_account_links (id, owner_id, account_id, provider, external_account_id, external_account_name, "
            "institution_name, state, import_kind, import_start, checkpoint, unlinked_at) "
            "VALUES (gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', 'Everyday Chequing', 'Harbour Bank', "
            "'unlinked', 'initial', '2026-09-01', '2026-10-01', now())",
        ),
        ("bank_account_links",),
        "links between Lumina accounts and bank accounts",
        (),
        id="link_without_connection",
    ),
    pytest.param(
        "9d2c6e1a4b58",
        ("INSERT INTO account_review_preferences (account_id, owner_id) VALUES (:account_id, :user_id)",),
        ("account_review_preferences",),
        "the review preferences",
        (),
        id="review_preferences",
    ),
    pytest.param(
        "c1f4a7e3d926",
        (
            "INSERT INTO bank_transactions "
            "(id, owner_id, account_id, provider, external_account_id, external_transaction_id, disposition) "
            "VALUES (gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', 'TRN-1001', 'dismissed')",
        ),
        ("bank_transactions",),
        "bank transaction records",
        (),
        id="bank_transactions",
    ),
    pytest.param(
        "2e9b5d8c1f47",
        (
            "INSERT INTO bank_pending_transactions "
            "(id, owner_id, account_id, external_transaction_id, transaction_date, amount, description, observed_at) "
            "VALUES (gen_random_uuid(), :user_id, :account_id, 'P-1', '2026-10-04', -2500, 'HOLD', now())",
        ),
        ("bank_pending_transactions",),
        "the pending bank transactions",
        (),
        id="pending_transactions",
    ),
    pytest.param(
        "a8d3f6b2c5e1",
        (
            _CONNECTION,
            "INSERT INTO bank_sync_jobs (id, owner_id, connection_id, kind) VALUES (gen_random_uuid(), :user_id, :connection_id, 'scheduled')",
        ),
        ("bank_sync_jobs",),
        "bank sync jobs",
        _WORKER_FUNCTIONS,
        id="sync_jobs",
    ),
]

# The revision that adds the description a user kept over the bank's, and the one before it
_KEPT_DESCRIPTION_REVISION = "8d86357d118a"
_BEFORE_KEPT_DESCRIPTION_REVISION = "c4d7a2e9f1b6"


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


async def _functions_present(database_name: str, names: tuple[str, ...]) -> set[str]:
    """Return which of the named functions a generated database's public schema holds"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as connection:
            found = await connection.scalars(
                text("SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY(:names)"),
                {"names": list(names)},
            )
            return set(found)
    finally:
        await engine.dispose()


@pytest.mark.parametrize(("revision", "seed", "tables", "loss", "functions"), _ROLLBACKS)
async def test_bank_sync_rollback_while_its_tables_hold_rows_is_refused(revision, seed, tables, loss, functions):
    """The downgrade names what it would delete and keeps it, then succeeds once emptied"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=revision)
        await _execute(_DATABASE_NAME, _OWNER + seed)

        refused = _run_alembic(_DATABASE_NAME, "downgrade", "-1")

        assert refused.returncode != 0
        assert "Refusing to roll back: it would delete " in refused.stderr
        assert loss in refused.stderr

        # The seeded row is still there to delete, so the refusal kept it
        assert await _execute(_DATABASE_NAME, (f"DELETE FROM {tables[0]}",)) == 1  # noqa: S608
        for table in tables[1:]:
            await _execute(_DATABASE_NAME, (f"DELETE FROM {table}",))  # noqa: S608
        emptied = _run_alembic(_DATABASE_NAME, "downgrade", "-1")
        assert emptied.returncode == 0, emptied.stdout + emptied.stderr
        assert await _functions_present(_DATABASE_NAME, functions) == set()

        # The tables and functions come back the way they went, so the rollback is a true inverse
        _run_alembic_upgrade(_DATABASE_NAME, revision=revision)
        assert await _functions_present(_DATABASE_NAME, functions) == set(functions)
    finally:
        await _drop_database(_DATABASE_NAME)


async def _bank_transactions_shape(database_name: str) -> tuple[list[str], str | None]:
    """Return the columns of a generated database's bank transactions, and the check that only accepted ones carry review state"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as connection:
            columns = await connection.scalars(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_transactions' ORDER BY column_name")
            )
            check = await connection.scalar(
                text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_bank_transactions_review_state'")
            )
            return list(columns), check
    finally:
        await engine.dispose()


async def test_kept_description_rollback_restores_the_bank_transactions_it_found():
    """Rolling back drops the kept descriptions and puts the review state check back as it was, and upgrading again adds both"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=_BEFORE_KEPT_DESCRIPTION_REVISION)
        before = await _bank_transactions_shape(_DATABASE_NAME)
        _run_alembic_upgrade(_DATABASE_NAME, revision=_KEPT_DESCRIPTION_REVISION)
        upgraded = await _bank_transactions_shape(_DATABASE_NAME)
        rolled_back = _run_alembic(_DATABASE_NAME, "downgrade", "-1")
        after_rollback = await _bank_transactions_shape(_DATABASE_NAME)
        _run_alembic_upgrade(_DATABASE_NAME, revision=_KEPT_DESCRIPTION_REVISION)
        upgraded_again = await _bank_transactions_shape(_DATABASE_NAME)
    finally:
        await _drop_database(_DATABASE_NAME)

    assert rolled_back.returncode == 0, rolled_back.stdout + rolled_back.stderr
    assert "kept_description" in upgraded[0]
    assert upgraded != before
    assert after_rollback == before
    assert upgraded_again == upgraded
