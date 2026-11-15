"""The migration that keeps the note and merchant each bank transaction carries

A provider whose note is its description already saved the note as the description, so its records
must come out of the migration with their note, or every waiting SimpleFIN item would lose the text
its filing card shows. A provider that fills the description with a merchant or payee name when the
bank sends no text can't be told apart once saved, so its records must get no note rather than a name
shown as one. No saved field held a merchant, so every record starts with none rather than a guess. A
dismissed record keeps only its identity, the note and merchant included. Seeding is plain SQL, so a
later change to a model can't break the insert into a database built only up to the revision under test
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

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_note"
_BEFORE_REVISION = "d4b9e1a7c3f6"
_NOTE_REVISION = "24f0f404f878"
_IDS = {
    "user_id": UUID("11111111-1111-4111-8111-111111111111"),
    "account_id": UUID("22222222-2222-4222-8222-222222222222"),
}


_SEED = (
    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO users (id, email, first_name, tz, base_currency) VALUES (:user_id, 'note@example.com', 'Note', 'America/Toronto', 'CAD')",
    "INSERT INTO accounts (id, owner_id, account_kind, account_type, name, currency, is_archived) "
    "VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Everyday', 'CAD', false)",
    # Each hash is one digit repeated, so the rows read back in the order written. Lunch Flow saved the
    # merchant's name as the description where the bank sent no text
    "INSERT INTO bank_transactions (id, owner_id, account_id, provider, external_account_id, external_transaction_hash, "
    "disposition, observed_date, observed_amount, description, observed_at) VALUES "
    "(gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', repeat('1', 64), 'awaiting_review', '2026-10-02', -450, "
    "'POS 4411 COFFEE', now()), "
    "(gen_random_uuid(), :user_id, :account_id, 'akahu', 'ACT-1', repeat('2', 64), 'awaiting_review', '2026-10-02', -450, "
    "'COUNTDOWN AUCKLAND', now()), "
    "(gen_random_uuid(), :user_id, :account_id, 'pluggy', 'ACT-1', repeat('3', 64), 'awaiting_review', '2026-10-02', -450, '  ', now()), "
    "(gen_random_uuid(), :user_id, :account_id, 'lunchflow', 'ACT-1', repeat('4', 64), 'awaiting_review', '2026-10-02', -450, "
    "'Uber Eats', now())",
    "INSERT INTO bank_transactions (id, owner_id, account_id, provider, external_account_id, external_transaction_hash, disposition) "
    "VALUES (gen_random_uuid(), :user_id, :account_id, 'simplefin', 'ACT-1', repeat('5', 64), 'dismissed')",
)

_NOTES = "SELECT provider, note, merchant FROM bank_transactions ORDER BY external_transaction_hash"
_NOTES_AFTER = [
    ("simplefin", "POS 4411 COFFEE", None),
    ("akahu", "COUNTDOWN AUCKLAND", None),
    ("pluggy", None, None),
    ("lunchflow", None, None),
    ("simplefin", None, None),
]


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


async def test_note_migration_carries_the_description_over_only_where_it_is_the_note():
    """SimpleFIN and Akahu records keep their description as their note, and a blank one, a merchant name or a dismissed record gets none"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=_BEFORE_REVISION)
        await _execute(*_SEED)

        _run_alembic_upgrade(_DATABASE_NAME, revision=_NOTE_REVISION)

        assert await _read(_NOTES) == _NOTES_AFTER
        assert await _read("SELECT description FROM bank_transactions WHERE provider = 'lunchflow'") == [("Uber Eats",)]

        # A dismissed record keeps only its identity, so it can't hold a note or a merchant either
        for column in ("note", "merchant"):
            with pytest.raises(IntegrityError, match="ck_bank_transactions_dismissed"):
                await _execute(f"UPDATE bank_transactions SET {column} = 'x' WHERE disposition = 'dismissed'")  # noqa: S608
    finally:
        await _drop_database(_DATABASE_NAME)


async def test_note_migration_rolls_back_to_no_note_and_upgrading_again_carries_the_descriptions_over_again():
    """The rollback drops the note and keeps every record, and upgrading again gives back the notes it can work out"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME, revision=_BEFORE_REVISION)
        await _execute(*_SEED)
        _run_alembic_upgrade(_DATABASE_NAME, revision=_NOTE_REVISION)

        rolled_back = _run_alembic(_DATABASE_NAME, "downgrade", _BEFORE_REVISION)

        assert rolled_back.returncode == 0, rolled_back.stdout + rolled_back.stderr
        assert {"note", "merchant"}.isdisjoint(await _columns())
        assert len(await _read("SELECT 1 FROM bank_transactions")) == len(_NOTES_AFTER)

        _run_alembic_upgrade(_DATABASE_NAME, revision=_NOTE_REVISION)
        assert await _read(_NOTES) == _NOTES_AFTER
    finally:
        await _drop_database(_DATABASE_NAME)
