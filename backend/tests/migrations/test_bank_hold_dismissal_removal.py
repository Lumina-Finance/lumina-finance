"""The migration that stops keeping whether a bank hold was dismissed

Holds are listed for awareness only, so the dismissal stamp goes. These tests catch the migration
deleting a hold, the dismissed one included, and a rollback that loses a hold or can't be upgraded
again. Seeding is plain SQL, so a later change to a model can't break the insert into a database built
only up to the revision under test
"""

from uuid import UUID

from sqlalchemy import text

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import (
    _create_engine_for_database,
    _drop_database,
    _recreate_database,
    _run_alembic,
    _run_alembic_upgrade,
)

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_hold_dismissal"
_BEFORE_REVISION = "24f0f404f878"
_REMOVAL_REVISION = "1ab249c82417"
_IDS = {
    "user_id": UUID("11111111-1111-4111-8111-111111111111"),
    "account_id": UUID("22222222-2222-4222-8222-222222222222"),
}

_SEED = (
    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO users (id, email, first_name, tz, base_currency) VALUES (:user_id, 'holds@example.com', 'Holds', 'America/Toronto', 'CAD')",
    "INSERT INTO accounts (id, owner_id, account_kind, account_type, name, currency, is_archived) "
    "VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Everyday', 'CAD', false)",
    "INSERT INTO bank_holds (id, owner_id, account_id, provider, external_account_id, external_transaction_hash, "
    "hold_date, description, observed_at, dismissed_at) VALUES "
    "(gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', repeat('1', 64), '2026-11-02', 'CARD CHECK', now(), now()), "
    "(gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', repeat('2', 64), '2026-11-03', 'HOTEL HOLD', now(), NULL)",
)

_HOLDS = "SELECT description FROM bank_holds ORDER BY external_transaction_hash"


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
    """Return the columns the generated database holds for bank holds"""
    rows = await _read("SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_holds'")
    return {name for (name,) in rows}


async def test_dismissal_removal_keeps_every_hold_and_rolls_back_to_none_dismissed():
    """The dismissed hold and the other both stay through the upgrade, the rollback and the upgrade again"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=_BEFORE_REVISION)
        await _execute(*_SEED)

        _run_alembic_upgrade(_DATABASE_NAME, revision=_REMOVAL_REVISION)

        assert "dismissed_at" not in await _columns()
        assert await _read(_HOLDS) == [("CARD CHECK",), ("HOTEL HOLD",)]

        rolled_back = _run_alembic(_DATABASE_NAME, "downgrade", _BEFORE_REVISION)

        assert rolled_back.returncode == 0, rolled_back.stdout + rolled_back.stderr
        assert await _read("SELECT description, dismissed_at FROM bank_holds ORDER BY external_transaction_hash") == [
            ("CARD CHECK", None),
            ("HOTEL HOLD", None),
        ]

        _run_alembic_upgrade(_DATABASE_NAME, revision=_REMOVAL_REVISION)
        assert await _read(_HOLDS) == [("CARD CHECK",), ("HOTEL HOLD",)]
    finally:
        await _drop_database(_DATABASE_NAME)
