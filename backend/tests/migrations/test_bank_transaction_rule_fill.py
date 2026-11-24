"""The migration that saves the rule values on a waiting bank item

A waiting item keeps the merchant, category and tags the rules gave it, and the digest of the rules it
was put through. These tests catch the migration changing an item that already waits, letting a
decided item keep either column, and a rollback that keeps a column or can't be upgraded again.
Seeding is plain SQL, so a later change to a model can't break the insert into a database built only
up to the revision under test
"""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import (
    _create_engine_for_database,
    _drop_database,
    _recreate_database,
    _run_alembic,
    _run_alembic_upgrade,
)

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_transaction_rule_fill"
_BEFORE_REVISION = "a8e3f1b6d492"
_FILL_REVISION = "c7b2e5a9d134"
_IDS = {
    "user_id": UUID("11111111-1111-4111-8111-111111111111"),
    "account_id": UUID("22222222-2222-4222-8222-222222222222"),
}

_SEED = (
    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO users (id, email, first_name, tz, base_currency) VALUES (:user_id, 'fill@example.com', 'Fill', 'America/Toronto', 'CAD')",
    "INSERT INTO accounts (id, owner_id, account_kind, account_type, name, currency, is_archived) "
    "VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Everyday', 'CAD', false)",
    "INSERT INTO bank_transactions (id, owner_id, account_id, provider, external_account_id, external_transaction_hash, disposition, "
    "observed_date, observed_amount, description, observed_at) VALUES "
    "(gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', repeat('1', 64), 'awaiting_review', '2026-11-02', -1250, 'MARKET', now())",
)

_WAITING = (
    "INSERT INTO bank_transactions (id, owner_id, account_id, provider, external_account_id, external_transaction_hash, disposition, "
    "observed_date, observed_amount, description, observed_at, rule_fill, rules_version) VALUES "
    "(gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', repeat('2', 64), 'awaiting_review', '2026-11-03', -1250, 'MARKET', now(), "
    "'{\"merchant\": {}}', repeat('a', 64))"
)

_DISMISSED = (
    "INSERT INTO bank_transactions (id, owner_id, account_id, provider, external_account_id, external_transaction_hash, disposition, {column}) "
    "VALUES (gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', repeat('3', 64), 'dismissed', {value})"
)


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


async def _columns() -> set[str]:
    """Return the columns the generated database holds for bank transactions"""
    rows = await _read("SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_transactions'")
    return {name for (name,) in rows}


async def _constraints() -> set[str]:
    """Return the check constraints the generated database holds for bank transactions"""
    rows = await _read("SELECT conname FROM pg_constraint WHERE conrelid = 'bank_transactions'::regclass AND contype = 'c'")
    return {name for (name,) in rows}


async def test_the_migration_adds_the_two_columns_and_the_check_and_its_rollback_drops_them():
    """A waiting item keeps no fill and no digest, only a waiting item can hold either, and a rollback leaves the item and upgrades again"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=_BEFORE_REVISION)
        await _execute(*_SEED)

        _run_alembic_upgrade(_DATABASE_NAME, revision=_FILL_REVISION)

        assert {"rule_fill", "rules_version"} <= await _columns()
        assert "ck_bank_transactions_rule_fill" in await _constraints()
        assert await _read("SELECT rule_fill, rules_version FROM bank_transactions") == [(None, None)], "an item already waiting is not filled"
        await _execute(_WAITING)
        for column, value in (("rule_fill", "'{\"merchant\": {}}'"), ("rules_version", "repeat('a', 64)")):
            with pytest.raises(IntegrityError, match="ck_bank_transactions_rule_fill"):
                await _execute(_DISMISSED.format(column=column, value=value))
        await _execute("DELETE FROM bank_transactions WHERE disposition = 'awaiting_review' AND rules_version IS NOT NULL")

        rolled_back = _run_alembic(_DATABASE_NAME, "downgrade", _BEFORE_REVISION)

        assert rolled_back.returncode == 0, rolled_back.stdout + rolled_back.stderr
        assert {"rule_fill", "rules_version"}.isdisjoint(await _columns())
        assert "ck_bank_transactions_rule_fill" not in await _constraints()
        assert await _read("SELECT description FROM bank_transactions") == [("MARKET",)]

        _run_alembic_upgrade(_DATABASE_NAME, revision=_FILL_REVISION)
        assert await _read("SELECT rule_fill, rules_version FROM bank_transactions") == [(None, None)]
    finally:
        await _drop_database(_DATABASE_NAME)
