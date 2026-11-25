"""The profile deletion wait migration adds the due and reminder times, and its rollback keeps a waiting profile from being deleted early

Seeding is plain SQL, so a later change to a model can't break the insert into a database built only up
to the revision under test
"""

from uuid import UUID

import pytest
from sqlalchemy import text

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic, _run_alembic_upgrade

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_profile_deletion_wait"
_REVISION = "c7a3e5d91b24"
_PREVIOUS_REVISION = "b4c8e2a6d1f3"

# A user marked before the revision, and a user who asked to delete the day before and was marked
_MARKED_BEFORE = UUID("11111111-1111-4111-8111-111111111111")
_WAITING = UUID("22222222-2222-4222-8222-222222222222")
_DUE = UUID("33333333-3333-4333-8333-333333333333")

_COLUMNS = (
    "SELECT column_name, is_nullable, data_type FROM information_schema.columns "
    "WHERE table_name = 'users' AND column_name LIKE 'deletion_%' ORDER BY 1"
)


@pytest.fixture
async def database():
    """A database of its own, dropped afterwards"""
    await _recreate_database(_DATABASE_NAME)
    try:
        yield _DATABASE_NAME
    finally:
        await _drop_database(_DATABASE_NAME)


async def _seed_marked_users() -> None:
    """Insert a currency and the three users, as the previous revision could hold them, the first with only the mark"""
    engine = _create_engine_for_database(_DATABASE_NAME)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) "
                    "VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING"
                )
            )
            for user_id, email in ((_MARKED_BEFORE, "before@example.com"), (_WAITING, "waiting@example.com"), (_DUE, "due@example.com")):
                await conn.execute(
                    text(
                        "INSERT INTO users (id, email, first_name, tz, base_currency, deletion_requested_at) "
                        "VALUES (:user_id, :email, 'Test', 'America/Toronto', 'CAD', now())"
                    ),
                    {"user_id": user_id, "email": email},
                )
    finally:
        await engine.dispose()


async def _scalars(statement: str) -> list:
    """Run one statement on the database under test and return the first column of every row"""
    engine = _create_engine_for_database(_DATABASE_NAME)
    try:
        async with engine.connect() as conn:
            return list(await conn.scalars(text(statement)))
    finally:
        await engine.dispose()


async def test_upgrade_adds_both_times_empty_and_the_listings_wait_for_a_due_time(database):
    """Both columns are nullable timestamps, a profile marked before the revision is still listed at once, and the reminder listing exists"""
    _run_alembic_upgrade(database, revision=_PREVIOUS_REVISION)
    await _seed_marked_users()
    _run_alembic_upgrade(database, revision=_REVISION)

    engine = _create_engine_for_database(database)
    try:
        async with engine.connect() as conn:
            columns = [tuple(row) for row in await conn.execute(text(_COLUMNS))]
    finally:
        await engine.dispose()
    assert columns == [
        ("deletion_due_at", "YES", "timestamp with time zone"),
        ("deletion_reminder_sent_at", "YES", "timestamp with time zone"),
        ("deletion_requested_at", "YES", "timestamp with time zone"),
    ]
    assert await _scalars("SELECT count(*) FROM users WHERE deletion_due_at IS NOT NULL OR deletion_reminder_sent_at IS NOT NULL") == [0]
    assert set(await _scalars("SELECT public.list_profiles_to_delete()")) == {_MARKED_BEFORE, _WAITING, _DUE}, (
        "a mark with no due time is listed at once"
    )
    assert await _scalars("SELECT to_regprocedure('public.list_profiles_to_remind()') IS NOT NULL") == [True]

    engine = _create_engine_for_database(database)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE users SET deletion_due_at = now() + interval '1 day' WHERE id = :user_id"), {"user_id": _WAITING})
            await conn.execute(text("UPDATE users SET deletion_due_at = now() - interval '1 day' WHERE id = :user_id"), {"user_id": _DUE})
    finally:
        await engine.dispose()
    assert set(await _scalars("SELECT public.list_profiles_to_delete()")) == {_MARKED_BEFORE, _DUE}, "a profile still waiting is not listed"


async def test_downgrade_unmarks_a_waiting_profile_keeps_the_others_marked_and_upgrades_back(database):
    """The rollback unmarks a profile still waiting so nothing goes early, drops the columns and listing, and the revision applies again"""
    _run_alembic_upgrade(database, revision=_REVISION)
    await _seed_marked_users()
    engine = _create_engine_for_database(database)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE users SET deletion_due_at = now() + interval '1 day' WHERE id = :user_id"), {"user_id": _WAITING})
            await conn.execute(text("UPDATE users SET deletion_due_at = now() - interval '1 day' WHERE id = :user_id"), {"user_id": _DUE})
    finally:
        await engine.dispose()

    downgraded = _run_alembic(database, "downgrade", _PREVIOUS_REVISION)
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr

    assert set(await _scalars("SELECT id FROM users WHERE deletion_requested_at IS NOT NULL")) == {_MARKED_BEFORE, _DUE}
    assert await _scalars(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'users' AND column_name IN ('deletion_due_at', 'deletion_reminder_sent_at')"
    ) == [0]
    assert set(await _scalars("SELECT public.list_profiles_to_delete()")) == {_MARKED_BEFORE, _DUE}, (
        "the previous listing works without the columns"
    )
    assert await _scalars("SELECT to_regprocedure('public.list_profiles_to_remind()') IS NULL") == [True]

    _run_alembic_upgrade(database, revision=_REVISION)
