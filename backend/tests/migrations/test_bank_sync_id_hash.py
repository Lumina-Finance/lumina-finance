"""The migration that keys the hash of each bank transaction's ID and drops the bank fields nothing reads

A bank transaction's ID was kept as the provider sent it, so a copy of the database alone held every ID. The
migration carries each saved record into the keyed hash the server now keeps, built in SQL, and a hash that
differs from the server's by a byte leaves every saved record unmatched, so the next sync brings in again
what the user already approved or dismissed. Dropping the merchant, category hint and provider extras the app
never reads must leave the rest of each record as it was
"""

from sqlalchemy import text

from app.bank_transaction_key import resolve_key
from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import (
    BANK_SYNC_ID_HASH_REVISION,
    BANK_SYNC_IDS,
    BANK_SYNC_SEED,
    BEFORE_BANK_SYNC_ID_HASH_REVISION,
    _create_engine_for_database,
    _drop_database,
    _recreate_database,
    _run_alembic,
    _run_alembic_upgrade,
    expected_bank_sync_hash,
)

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_id_hash"


async def _read(statement: str) -> list[tuple]:
    """Return the rows a query reads from the generated database"""
    engine = _create_engine_for_database(_DATABASE_NAME)
    try:
        async with engine.connect() as connection:
            return [tuple(row) for row in await connection.execute(text(statement), BANK_SYNC_IDS)]
    finally:
        await engine.dispose()


async def _execute(*statements: str) -> None:
    """Run statements against the generated database in one transaction"""
    engine = _create_engine_for_database(_DATABASE_NAME)
    try:
        async with engine.begin() as connection:
            for statement in statements:
                await connection.execute(text(statement), BANK_SYNC_IDS)
    finally:
        await engine.dispose()


async def _columns(table: str) -> set[str]:
    """Return the columns the generated database holds for a table"""
    rows = await _read(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'")  # noqa: S608
    return {name for (name,) in rows}


async def test_hash_migration_keys_each_saved_id_as_the_server_does_and_drops_the_fields_nothing_reads():
    """Each saved ID becomes the keyed hash, the rest of the record stays, and the unread fields are gone"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=BEFORE_BANK_SYNC_ID_HASH_REVISION)
        await _execute(*BANK_SYNC_SEED)

        _run_alembic_upgrade(_DATABASE_NAME, revision=BANK_SYNC_ID_HASH_REVISION)

        kept = await _read(
            "SELECT external_transaction_hash, disposition, description, observed_amount FROM bank_transactions ORDER BY disposition"
        )
        key = resolve_key(generate=False)
        assert kept == [
            (expected_bank_sync_hash(key, "ACT-1", "TRN-coffee"), "awaiting_review", "POS 4411 COFFEE", -450),
            (expected_bank_sync_hash(key, "ACT-1", "TRN-refund"), "dismissed", None, None),
        ]
        assert {"external_transaction_id", "merchant_name", "category_hint", "extras"}.isdisjoint(await _columns("bank_transactions"))
        assert "external_transaction_id" not in await _columns("bank_pending_transactions")
        assert await _read("SELECT description, amount FROM bank_pending_transactions") == [("HOLD", -2500)]
    finally:
        await _drop_database(_DATABASE_NAME)


async def test_hash_migration_rollback_is_refused_while_bank_transactions_hold_hashes_and_restores_the_columns_once_empty():
    """A hash can't be turned back into the ID it came from, so the rollback refuses rather than invent one"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=BEFORE_BANK_SYNC_ID_HASH_REVISION)
        await _execute(*BANK_SYNC_SEED)
        _run_alembic_upgrade(_DATABASE_NAME, revision=BANK_SYNC_ID_HASH_REVISION)

        refused = _run_alembic(_DATABASE_NAME, "downgrade", "-1")

        assert refused.returncode != 0
        assert "Refusing to roll back: it would delete " in refused.stderr
        assert "the keyed hashes of bank transaction IDs" in refused.stderr
        assert len(await _read("SELECT 1 FROM bank_transactions")) == 2

        await _execute("DELETE FROM bank_transactions", "DELETE FROM bank_pending_transactions")
        emptied = _run_alembic(_DATABASE_NAME, "downgrade", "-1")
        assert emptied.returncode == 0, emptied.stdout + emptied.stderr
        assert {"external_transaction_id", "merchant_name", "category_hint", "extras"} <= await _columns("bank_transactions")

        _run_alembic_upgrade(_DATABASE_NAME, revision=BANK_SYNC_ID_HASH_REVISION)
        assert "external_transaction_hash" in await _columns("bank_transactions")
    finally:
        await _drop_database(_DATABASE_NAME)
