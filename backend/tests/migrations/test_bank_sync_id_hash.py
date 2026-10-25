"""The migration that keys the hash of each bank transaction's ID and drops the bank fields nothing reads

A bank transaction's ID was kept as the provider sent it, so a copy of the database alone held every ID. The
migration carries each saved record into the keyed hash the server now keeps, built in SQL, and a hash that
differs from the server's by a byte leaves every saved record unmatched, so the next sync brings in again
what the user already approved or dismissed. Dropping the merchant, category hint and provider extras the app
never reads must leave the rest of each record as it was. Seeding is plain SQL, so a later change to a model
can't break the insert into a database built only up to the revision under test
"""

import hashlib
import hmac
from uuid import UUID

from sqlalchemy import text

from app.bank_transaction_key import resolve_key
from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import (
    _create_engine_for_database,
    _drop_database,
    _recreate_database,
    _run_alembic,
    _run_alembic_upgrade,
)

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_id_hash"
_BEFORE_REVISION = "8d86357d118a"
_HASH_REVISION = "a2d7f4c8e1b6"
_IDS = {
    "user_id": UUID("11111111-1111-4111-8111-111111111111"),
    "account_id": UUID("22222222-2222-4222-8222-222222222222"),
}

_SEED = (
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


def _expected_hash(external_account_id: str, external_transaction_id: str) -> str:
    """Return the hash the server keeps for a SimpleFIN transaction, worked out here from its definition

    HMAC-SHA256 under the server's key of the SHA-256 digest over the provider and bank account, a
    zero byte and the transaction ID
    """
    digest = hashlib.sha256(f"simplefin:{external_account_id}".encode() + b"\0" + external_transaction_id.encode()).digest()
    return hmac.new(resolve_key(generate=False), digest, hashlib.sha256).hexdigest()


async def _read(statement: str) -> list[tuple]:
    """Return the rows a query reads from the generated database"""
    engine = _create_engine_for_database(_DATABASE_NAME)
    try:
        async with engine.connect() as connection:
            return [tuple(row) for row in await connection.execute(text(statement), _IDS)]
    finally:
        await engine.dispose()


async def _execute(*statements: str) -> None:
    """Run statements against the generated database in one transaction"""
    engine = _create_engine_for_database(_DATABASE_NAME)
    try:
        async with engine.begin() as connection:
            for statement in statements:
                await connection.execute(text(statement), _IDS)
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
        _run_alembic_upgrade(_DATABASE_NAME, revision=_BEFORE_REVISION)
        await _execute(*_SEED)

        _run_alembic_upgrade(_DATABASE_NAME, revision=_HASH_REVISION)

        kept = await _read(
            "SELECT external_transaction_hash, disposition, description, observed_amount FROM bank_transactions ORDER BY disposition"
        )
        assert kept == [
            (_expected_hash("ACT-1", "TRN-coffee"), "awaiting_review", "POS 4411 COFFEE", -450),
            (_expected_hash("ACT-1", "TRN-refund"), "dismissed", None, None),
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
        _run_alembic_upgrade(_DATABASE_NAME, revision=_BEFORE_REVISION)
        await _execute(*_SEED)
        _run_alembic_upgrade(_DATABASE_NAME, revision=_HASH_REVISION)

        refused = _run_alembic(_DATABASE_NAME, "downgrade", "-1")

        assert refused.returncode != 0
        assert "Refusing to roll back: it would delete " in refused.stderr
        assert "the keyed hashes of bank transaction IDs" in refused.stderr
        assert len(await _read("SELECT 1 FROM bank_transactions")) == 2

        await _execute("DELETE FROM bank_transactions", "DELETE FROM bank_pending_transactions")
        emptied = _run_alembic(_DATABASE_NAME, "downgrade", "-1")
        assert emptied.returncode == 0, emptied.stdout + emptied.stderr
        assert {"external_transaction_id", "merchant_name", "category_hint", "extras"} <= await _columns("bank_transactions")

        _run_alembic_upgrade(_DATABASE_NAME, revision=_HASH_REVISION)
        assert "external_transaction_hash" in await _columns("bank_transactions")
    finally:
        await _drop_database(_DATABASE_NAME)
