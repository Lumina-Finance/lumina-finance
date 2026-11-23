"""The profile deletion migration lets a user row go with every row naming the user, and its rollback refuses that again

Seeding is plain SQL, so a later change to a model can't break the insert into a database built only up
to the revision under test
"""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic, _run_alembic_upgrade

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_profile_deletion"
_REVISION = "e6b2d9f4a1c7"
_PREVIOUS_REVISION = "a4c8e2f6b1d3"
_USER_ID = UUID("11111111-1111-4111-8111-111111111111")

# A user with a row in a table whose foreign key had no delete rule before the revision, and one in a
# table whose key already cascaded
_SEED = (
    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
    "INSERT INTO users (id, email, first_name, tz, base_currency) VALUES (:user_id, 'gone@example.com', 'Gone', 'America/Toronto', 'CAD')",
    "INSERT INTO accounts (id, owner_id, account_kind, account_type, name, currency, is_archived) "
    "VALUES (gen_random_uuid(), :user_id, 'ASSET', 'CHECKING', 'Everyday', 'CAD', false)",
    "INSERT INTO tags (id, owner_id, name) VALUES (gen_random_uuid(), :user_id, 'Trip')",
)


@pytest.fixture
async def database():
    """A database of its own, dropped afterwards"""
    await _recreate_database(_DATABASE_NAME)
    try:
        yield _DATABASE_NAME
    finally:
        await _drop_database(_DATABASE_NAME)


async def _seed_and_delete_user() -> int:
    """Seed the user and their rows, then delete the user row, returning how many accounts are left"""
    engine = _create_engine_for_database(_DATABASE_NAME)
    try:
        async with engine.begin() as conn:
            for statement in _SEED:
                await conn.execute(text(statement), {"user_id": _USER_ID})
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM users WHERE id = :user_id"), {"user_id": _USER_ID})
        async with engine.connect() as conn:
            return await conn.scalar(text("SELECT count(*) FROM accounts"))
    finally:
        await engine.dispose()


async def test_upgrade_deletes_a_users_rows_with_the_user_and_adds_the_mark(database):
    """After the revision, deleting a user deletes their accounts and tags, and every user starts unmarked"""
    _run_alembic_upgrade(database, revision=_REVISION)

    assert await _seed_and_delete_user() == 0

    engine = _create_engine_for_database(database)
    try:
        async with engine.connect() as conn:
            column = await conn.scalar(
                text("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'deletion_requested_at'")
            )
            listing = await conn.scalar(text("SELECT to_regprocedure('public.list_profiles_to_delete()') IS NOT NULL"))
    finally:
        await engine.dispose()
    assert column == "YES"
    assert listing


async def test_downgrade_refuses_to_delete_a_user_with_rows_again_and_upgrades_back(database):
    """The rollback puts back the keys that refuse a user row while rows name it, drops the mark, and the revision applies again"""
    _run_alembic_upgrade(database, revision=_REVISION)
    downgraded = _run_alembic(database, "downgrade", _PREVIOUS_REVISION)
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr

    with pytest.raises(IntegrityError):
        await _seed_and_delete_user()

    engine = _create_engine_for_database(database)
    try:
        async with engine.connect() as conn:
            column = await conn.scalar(
                text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'deletion_requested_at'")
            )
    finally:
        await engine.dispose()
    assert column == 0

    _run_alembic_upgrade(database, revision=_REVISION)
