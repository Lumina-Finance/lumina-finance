"""Alembic schema parity tests"""

import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import Enum as SqlaEnum
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from app.config.database import MIGRATOR_DB_USER
from app.models.base import Base
from app.services.merchants.defaults import (
    SELF_MERCHANT_NAME,
    SYSTEM_MERCHANT_NAMES,
    UNKNOWN_MERCHANT_NAME,
)
from tests.conftest import (
    DB_HOST,
    DB_PASSWORD,
    DB_PORT,
    DB_USER,
    WORKER_DB_NAME,
)

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_TEST_DB_NAME = f"{WORKER_DB_NAME}_alembic_schema"
_ALEMBIC_ENUM_DB_NAME = f"{WORKER_DB_NAME}_alembic_enums"
_ALEMBIC_AUTH_RESET_DB_NAME = f"{WORKER_DB_NAME}_alembic_auth_reset"
_AUTH_SESSIONS_REVISION = "a4f8d1c2e7b3"
_ALEMBIC_SYSTEM_MERCHANT_DB_NAME = f"{WORKER_DB_NAME}_alembic_system_merchant"
_BEFORE_SYSTEM_MERCHANTS_REVISION = "cbf7ada87de3"
_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME = f"{WORKER_DB_NAME}_alembic_unknown_merchant"
_BEFORE_UNKNOWN_MERCHANT_REVISION = "93e7aa96d2ae"
_ALEMBIC_FOLDED_CATEGORY_DB_NAME = f"{WORKER_DB_NAME}_alembic_folded_categories"
_ALEMBIC_FOLDED_MERCHANT_DB_NAME = f"{WORKER_DB_NAME}_alembic_folded_merchants"
_BEFORE_FOLDED_NAMES_REVISION = "6a1f132b9da2"


async def test_alembic_schema_columns_match_model_metadata() -> None:
    """Verify Alembic creates the same table columns expected by the models"""
    await _recreate_database(_ALEMBIC_TEST_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_TEST_DB_NAME)
        actual_columns = await _get_database_columns(_ALEMBIC_TEST_DB_NAME)
        expected_columns = _get_model_columns()
        assert actual_columns == expected_columns
    finally:
        await _drop_database(_ALEMBIC_TEST_DB_NAME)


async def test_alembic_enum_labels_match_model_metadata() -> None:
    """Verify Alembic builds the same enum labels the models declare

    The route tests build the schema from model metadata, so a model enum that gains a value with no
    migration to add it still passes there yet breaks a migration-built database. Comparing the two
    directly catches that drift, such as a new auth provider added to the type without a migration
    """
    await _recreate_database(_ALEMBIC_ENUM_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_ENUM_DB_NAME)
        actual_enums = await _get_database_enums(_ALEMBIC_ENUM_DB_NAME)
        expected_enums = _get_model_enums()
        assert actual_enums == expected_enums
    finally:
        await _drop_database(_ALEMBIC_ENUM_DB_NAME)


async def test_auth_session_overhaul_clears_legacy_auth_state() -> None:
    """Verify the auth-token migration does not carry old sessions forward"""
    await _recreate_database(_ALEMBIC_AUTH_RESET_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_AUTH_RESET_DB_NAME, revision=_AUTH_SESSIONS_REVISION)
        await _seed_legacy_auth_state(_ALEMBIC_AUTH_RESET_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_AUTH_RESET_DB_NAME)

        session_count, token_count, active_tokens_exists = await _get_auth_storage_state(
            _ALEMBIC_AUTH_RESET_DB_NAME,
        )
        assert session_count == 0
        assert token_count == 0
        assert not active_tokens_exists
    finally:
        await _drop_database(_ALEMBIC_AUTH_RESET_DB_NAME)


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
    # Close active connections so PostgreSQL can drop the generated database
    await conn.execute(
        text(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = :database_name
              AND pid <> pg_backend_pid()
            """,
        ),
        {"database_name": database_name},
    )


def _run_alembic_upgrade(database_name: str, *, revision: str = "head") -> None:
    """Run Alembic upgrade against a generated parity database"""
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
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


async def _seed_legacy_auth_state(database_name: str) -> None:
    """Insert old auth rows that the overhaul migration should discard"""
    user_id = UUID("11111111-1111-4111-8111-111111111111")
    session_id = UUID("22222222-2222-4222-8222-222222222222")
    token_id = UUID("33333333-3333-4333-8333-333333333333")

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:

            # Seed the user dependency needed by legacy auth rows
            await conn.execute(
                text(
                    """
                    INSERT INTO currencies (id, name, symbol, minor_unit_exponent)
                    VALUES ('CAD', 'Canadian Dollar', '$', 2)
                    """,
                ),
            )

            # Seed a user so legacy auth rows are valid before the migration runs
            await conn.execute(
                text(
                    """
                    INSERT INTO users (id, email, first_name, tz, base_currency)
                    VALUES (:user_id, 'migration-auth-reset@example.com', 'Migration', 'America/Toronto', 'CAD')
                    """,
                ),
                {"user_id": user_id},
            )

            # Seed the old session row that should force the user to log in again
            await conn.execute(
                text(
                    """
                    INSERT INTO auth_sessions (id, user_id, expires_at)
                    VALUES (:session_id, :user_id, now() + interval '1 day')
                    """,
                ),
                {"session_id": session_id, "user_id": user_id},
            )

            # Seed the old token row that should be removed with the legacy table
            await conn.execute(
                text(
                    """
                    INSERT INTO active_tokens (jti, user_id, session_id, expires_at)
                    VALUES (:token_id, :user_id, :session_id, now() + interval '1 day')
                    """,
                ),
                {"token_id": token_id, "user_id": user_id, "session_id": session_id},
            )
    finally:
        await engine.dispose()


async def _get_auth_storage_state(database_name: str) -> tuple[int, int, bool]:
    """Return auth storage row counts after the overhaul migration"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:

            # Count remaining sessions to verify pre-overhaul login state was discarded
            session_count = await conn.scalar(text("SELECT count(*) FROM auth_sessions"))

            # Count token allowlist rows to verify no token rows exist after upgrade
            token_count = await conn.scalar(text("SELECT count(*) FROM auth_tokens"))

            # Check the legacy table is gone so old active token rows cannot survive
            active_tokens_exists = await conn.scalar(
                text("SELECT to_regclass('public.active_tokens') IS NOT NULL"),
            )
            return int(session_count or 0), int(token_count or 0), bool(active_tokens_exists)
    finally:
        await engine.dispose()


async def _get_database_columns(database_name: str) -> dict[str, set[str]]:
    """Return public table columns from a generated parity database"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:

            # Fetch public schema columns created by Alembic for comparison with model metadata
            result = await conn.execute(
                text(
                    """
                    SELECT table_name, column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name <> 'alembic_version'
                    ORDER BY table_name, ordinal_position
                    """,
                ),
            )
            columns_by_table: dict[str, set[str]] = {}
            for row in result:
                columns_by_table.setdefault(row.table_name, set()).add(row.column_name)
            return columns_by_table
    finally:
        await engine.dispose()


def _get_model_columns() -> dict[str, set[str]]:
    """Return SQLAlchemy model columns keyed by table name"""
    columns_by_table = {
        table.name: {column.name for column in table.columns}
        for table in Base.metadata.sorted_tables
    }
    return columns_by_table


async def _get_database_enums(database_name: str) -> dict[str, set[str]]:
    """Return enum type labels from a generated parity database, keyed by type name"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:

            # Fetch every public enum type and its labels created by Alembic
            result = await conn.execute(
                text(
                    """
                    SELECT t.typname AS type_name, e.enumlabel AS label
                    FROM pg_type t
                    JOIN pg_enum e ON e.enumtypid = t.oid
                    JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE n.nspname = 'public'
                    """,
                ),
            )
            labels_by_type: dict[str, set[str]] = {}
            for row in result:
                labels_by_type.setdefault(row.type_name, set()).add(row.label)
            return labels_by_type
    finally:
        await engine.dispose()


def _get_model_enums() -> dict[str, set[str]]:
    """Return SQLAlchemy model enum labels keyed by type name, deduped across columns"""
    labels_by_type: dict[str, set[str]] = {}
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, SqlaEnum):
                labels_by_type[column.type.name] = set(column.type.enums)
    return labels_by_type


def _create_engine_for_database(database_name: str, *, isolation_level: str | None = None):
    """Create an async engine for a test database"""
    database_url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{database_name}"
    engine = create_async_engine(database_url, poolclass=NullPool, isolation_level=isolation_level)
    return engine


async def test_system_merchant_migration_folds_everyones_own_myself() -> None:
    """Verify the fold keeps transactions and removes the duplicates, whatever their capitalisation"""
    await _recreate_database(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME, revision=_BEFORE_SYSTEM_MERCHANTS_REVISION)
        transaction_id = await _seed_own_myself_merchant(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)
        try:
            async with engine.connect() as conn:
                system_merchants = (await conn.execute(text(
                    "SELECT id, name FROM merchants WHERE is_system = true",
                ))).all()
                remaining_own = (await conn.execute(text(
                    "SELECT count(*) FROM merchants WHERE is_system = false",
                ))).scalar_one()
                merchant_on_transaction = (await conn.execute(
                    text("SELECT merchant_id FROM transactions WHERE id = :id"),
                    {"id": transaction_id},
                )).scalar_one()
        finally:
            await engine.dispose()

        # Compared as a set, since the query states no order and the app ships more than one
        merchant_ids_by_name = {name: merchant_id for merchant_id, name in system_merchants}
        assert set(merchant_ids_by_name) == set(SYSTEM_MERCHANT_NAMES)
        assert remaining_own == 0
        assert merchant_on_transaction == merchant_ids_by_name[SELF_MERCHANT_NAME]
    finally:
        await _drop_database(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)


async def test_unknown_merchant_migration_folds_a_personal_one_and_spares_a_group_one() -> None:
    """Verify the fold takes a user's own Unknown and leaves a group's alone"""
    await _recreate_database(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME, revision=_BEFORE_UNKNOWN_MERCHANT_REVISION)
        seeded = await _seed_own_unknown_merchants(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)
        try:
            async with engine.connect() as conn:
                system_merchant_id = (await conn.execute(
                    text("SELECT id FROM merchants WHERE is_system = true AND name = :name"),
                    {"name": UNKNOWN_MERCHANT_NAME},
                )).scalar_one()
                merchant_on_transaction = (await conn.execute(
                    text("SELECT merchant_id FROM transactions WHERE id = :id"),
                    {"id": seeded["transaction_id"]},
                )).scalar_one()
                personal_remaining = (await conn.execute(
                    text("SELECT count(*) FROM merchants WHERE id = :id"),
                    {"id": seeded["personal_merchant_id"]},
                )).scalar_one()
                group_remaining = (await conn.execute(
                    text("SELECT count(*) FROM merchants WHERE id = :id"),
                    {"id": seeded["group_merchant_id"]},
                )).scalar_one()
        finally:
            await engine.dispose()

        # The transaction that pointed at the user's own spelling now points at the shared merchant,
        # and their own row is gone
        assert merchant_on_transaction == system_merchant_id
        assert personal_remaining == 0

        # A group's merchant is left alone, since taking one from a group is a decision nobody has
        # made and folding it could not be undone
        assert group_remaining == 1
    finally:
        await _drop_database(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)


async def _seed_own_unknown_merchants(database_name: str) -> dict[str, UUID]:
    """Insert a personal merchant spelled UNKNOWN carrying a transaction, and a group-owned one

    Returns:
        The identifiers the fold is judged against
    """
    user_id = UUID("11111111-2222-4333-8444-555555555555")
    group_id = UUID("22222222-3333-4444-8555-666666666666")
    account_id = UUID("33333333-4444-4555-8666-777777777777")
    category_id = UUID("44444444-5555-4666-8777-888888888888")
    personal_merchant_id = UUID("55555555-6666-4777-8888-999999999999")
    group_merchant_id = UUID("66666666-7777-4888-8999-aaaaaaaaaaaa")
    transaction_id = UUID("77777777-8888-4999-8aaa-bbbbbbbbbbbb")

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                " VALUES ('CAD', 'Canadian Dollar', '$', 2)",
            ))
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-unknown@example.com', 'Migration', 'America/Toronto', 'CAD')",
                ),
                {"user_id": user_id},
            )
            await conn.execute(
                text("INSERT INTO groups (id, owner_id, name) VALUES (:group_id, :user_id, 'Household')"),
                {"group_id": group_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO accounts"
                    " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                    " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Chequing', 'CAD', false)",
                ),
                {"account_id": account_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                    " VALUES (:category_id, :user_id, 'Shopping', 'EXPENSE', false)",
                ),
                {"category_id": category_id, "user_id": user_id},
            )

            # Spelled in capitals, which the fold has to catch as the same intent
            await conn.execute(
                text("INSERT INTO merchants (id, owner_id, name) VALUES (:merchant_id, :user_id, 'UNKNOWN')"),
                {"merchant_id": personal_merchant_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO merchants (id, owner_id, group_id, name)"
                    " VALUES (:merchant_id, :user_id, :group_id, :name)",
                ),
                {
                    "merchant_id": group_merchant_id,
                    "user_id": user_id,
                    "group_id": group_id,
                    "name": UNKNOWN_MERCHANT_NAME,
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO transactions"
                    " (id, created_by_user_id, account_id, dt, merchant_id, category_id, amount, currency)"
                    " VALUES (:transaction_id, :user_id, :account_id, '2026-03-15', :merchant_id,"
                    " :category_id, -2500, 'CAD')",
                ),
                {
                    "transaction_id": transaction_id,
                    "user_id": user_id,
                    "account_id": account_id,
                    "merchant_id": personal_merchant_id,
                    "category_id": category_id,
                },
            )
    finally:
        await engine.dispose()

    return {
        "transaction_id": transaction_id,
        "personal_merchant_id": personal_merchant_id,
        "group_merchant_id": group_merchant_id,
    }


async def test_folded_name_migration_merges_categories_and_numbers_the_ones_recording_opposite_kinds() -> None:
    """Verify the fold merges within a kind, numbers across kinds, trims, and leaves other scopes alone

    Every case is seeded into one database and judged after a single upgrade, since each build of one
    runs alembic through a subprocess and the cases do not interfere: they use separate names
    """
    await _recreate_database(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_FOLDED_CATEGORY_DB_NAME, revision=_BEFORE_FOLDED_NAMES_REVISION)
        seeded = await _seed_categories_differing_only_in_capitals(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)
        try:
            async with engine.connect() as conn:
                grocery_ids = (await conn.execute(
                    text(
                        "SELECT id FROM categories"
                        " WHERE owner_id = :user_id AND group_id IS NULL AND lower(name) = 'groceries'",
                    ),
                    {"user_id": seeded["user_id"]},
                )).scalars().all()
                grocery_transaction_categories = (await conn.execute(
                    text("SELECT category_id FROM transactions WHERE id = ANY(:ids)"),
                    {"ids": [seeded["older_grocery_transaction_id"], seeded["newer_grocery_transaction_id"]]},
                )).scalars().all()
                active_tracked_rows = (await conn.execute(
                    text(
                        "SELECT count(*) FROM budget_tracked_categories"
                        " WHERE base_budget_id = :budget_id AND removed_at IS NULL",
                    ),
                    {"budget_id": seeded["base_budget_id"]},
                )).scalar_one()
                bonus_names = dict((await conn.execute(
                    text("SELECT id, name FROM categories WHERE id = ANY(:ids)"),
                    {"ids": [seeded["income_bonus_id"], seeded["expense_bonus_id"]]},
                )).all())
                expense_bonus_transaction_category = (await conn.execute(
                    text("SELECT category_id FROM transactions WHERE id = :id"),
                    {"id": seeded["expense_bonus_transaction_id"]},
                )).scalar_one()
                dining = (await conn.execute(
                    text(
                        "SELECT id, name FROM categories"
                        " WHERE owner_id = :user_id AND group_id IS NULL AND lower(name) = 'dining'",
                    ),
                    {"user_id": seeded["user_id"]},
                )).all()
                group_category_remaining = (await conn.execute(
                    text("SELECT count(*) FROM categories WHERE id = :id"),
                    {"id": seeded["group_grocery_id"]},
                )).scalar_one()
                adjustment_row = (await conn.execute(
                    text(
                        "SELECT category_id, counterparty_account_id, counterparty_account_scope"
                        " FROM transactions WHERE id = :id",
                    ),
                    {"id": seeded["adjustment_transaction_id"]},
                )).one()
        finally:
            await engine.dispose()

        # Groceries and GROCERIES record the same kind, so the later one is merged into the older and
        # both transactions follow it
        assert grocery_ids == [seeded["older_grocery_id"]]
        assert set(grocery_transaction_categories) == {seeded["older_grocery_id"]}

        # The budget tracked both, and one category cannot be tracked twice on one budget
        assert active_tracked_rows == 1

        # An income Bonus and an expense bonus mean different things, so both survive and the later
        # one is numbered rather than merged, leaving its transactions where they were
        assert bonus_names == {seeded["income_bonus_id"]: "Bonus", seeded["expense_bonus_id"]: "bonus (2)"}
        assert expense_bonus_transaction_category == seeded["expense_bonus_id"]

        # Trimming happens first, so a name stored with a trailing space collides with the plain one
        # and is folded like any other pair
        assert dining == [(seeded["spaced_dining_id"], "Dining")]

        # A group's category shares no scope with a personal one, so it is untouched
        assert group_category_remaining == 1

        # Balance Adjustment records no counterparty account, so a transaction moving onto it loses
        # the account it recorded, exactly as editing one onto that category by hand does
        assert adjustment_row == (seeded["older_adjustment_id"], None, None)

        await _assert_second_category_differing_only_in_capitals_is_refused(
            _ALEMBIC_FOLDED_CATEGORY_DB_NAME,
            seeded["user_id"],
        )
    finally:
        await _drop_database(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)


async def test_folded_name_migration_merges_merchants_differing_only_in_capitals() -> None:
    """Verify merchants fold onto the oldest and the index then refuses a second spelling"""
    await _recreate_database(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_FOLDED_MERCHANT_DB_NAME, revision=_BEFORE_FOLDED_NAMES_REVISION)
        seeded = await _seed_merchants_differing_only_in_capitals(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)
        try:
            async with engine.connect() as conn:
                remaining = (await conn.execute(
                    text(
                        "SELECT id, name FROM merchants"
                        " WHERE owner_id = :user_id AND lower(name) = 'amazon'",
                    ),
                    {"user_id": seeded["user_id"]},
                )).all()
                merchants_on_transactions = (await conn.execute(
                    text("SELECT merchant_id FROM transactions WHERE id = ANY(:ids)"),
                    {"ids": [seeded["older_transaction_id"], seeded["newer_transaction_id"]]},
                )).scalars().all()
        finally:
            await engine.dispose()

        # The later spelling is gone and both transactions point at the one that was there first
        assert remaining == [(seeded["older_merchant_id"], "Amazon")]
        assert set(merchants_on_transactions) == {seeded["older_merchant_id"]}

        await _assert_second_merchant_differing_only_in_capitals_is_refused(
            _ALEMBIC_FOLDED_MERCHANT_DB_NAME,
            seeded["user_id"],
        )
    finally:
        await _drop_database(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)


async def _assert_second_category_differing_only_in_capitals_is_refused(
    database_name: str,
    user_id: UUID,
) -> None:
    """Check the database itself refuses the pair, not only the routes

    Written straight to the table, since this is about what the index allows rather than what a
    route checks. Without it the migration could fold correctly and build no index at all, and every
    other assertion here would still pass
    """
    engine = _create_engine_for_database(database_name)
    try:
        with pytest.raises(IntegrityError):
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                        " VALUES (gen_random_uuid(), :user_id, 'GROCERIES', 'EXPENSE', false)",
                    ),
                    {"user_id": user_id},
                )
    finally:
        await engine.dispose()


async def _assert_second_merchant_differing_only_in_capitals_is_refused(
    database_name: str,
    user_id: UUID,
) -> None:
    """Check the database itself refuses the pair, not only the routes"""
    engine = _create_engine_for_database(database_name)
    try:
        with pytest.raises(IntegrityError):
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO merchants (id, owner_id, name)"
                        " VALUES (gen_random_uuid(), :user_id, 'amazon')",
                    ),
                    {"user_id": user_id},
                )
    finally:
        await engine.dispose()


async def _seed_own_myself_merchant(database_name: str) -> UUID:
    """Insert a user-owned merchant spelled MYSELF, carrying one transaction

    Returns:
        Identifier of the transaction that should survive the fold
    """
    user_id = UUID("44444444-4444-4444-8444-444444444444")
    account_id = UUID("55555555-5555-4555-8555-555555555555")
    category_id = UUID("66666666-6666-4666-8666-666666666666")
    merchant_id = UUID("77777777-7777-4777-8777-777777777777")
    transaction_id = UUID("88888888-8888-4888-8888-888888888888")

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                " VALUES ('CAD', 'Canadian Dollar', '$', 2)",
            ))
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-merchant@example.com', 'Migration', 'America/Toronto', 'CAD')",
                ),
                {"user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO accounts"
                    " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                    " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Chequing', 'CAD', false)",
                ),
                {"account_id": account_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                    " VALUES (:category_id, :user_id, 'Moving money', 'TRANSFER', false)",
                ),
                {"category_id": category_id, "user_id": user_id},
            )

            # Spelled in capitals, which the fold has to catch as the same intent
            await conn.execute(
                text(
                    "INSERT INTO merchants (id, owner_id, name) VALUES (:merchant_id, :user_id, 'MYSELF')",
                ),
                {"merchant_id": merchant_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO transactions"
                    " (id, created_by_user_id, account_id, dt, merchant_id, category_id, amount, currency)"
                    " VALUES (:transaction_id, :user_id, :account_id, '2026-03-15', :merchant_id,"
                    " :category_id, -5000, 'CAD')",
                ),
                {
                    "transaction_id": transaction_id,
                    "user_id": user_id,
                    "account_id": account_id,
                    "merchant_id": merchant_id,
                    "category_id": category_id,
                },
            )
    finally:
        await engine.dispose()
    return transaction_id


async def _seed_categories_differing_only_in_capitals(database_name: str) -> dict[str, UUID]:
    """Insert every shape of category collision the fold has to settle

    Four pairs, each a case of its own: two expense categories spelled differently, an income and an
    expense sharing a name, one stored with a trailing space beside the plain spelling, and a
    personal category beside a group's of the same name. The Balance Adjustment pair carries a
    transaction recording a counterparty account, which moving onto that category has to drop

    Returns:
        The identifiers the fold is judged against
    """
    ids = {
        "user_id": UUID("aaaaaaaa-1111-4111-8111-111111111111"),
        "group_id": UUID("aaaaaaaa-2222-4222-8222-222222222222"),
        "account_id": UUID("aaaaaaaa-3333-4333-8333-333333333333"),
        "counterparty_account_id": UUID("aaaaaaaa-4444-4444-8444-444444444444"),
        "older_grocery_id": UUID("bbbbbbbb-1111-4111-8111-111111111111"),
        "newer_grocery_id": UUID("bbbbbbbb-2222-4222-8222-222222222222"),
        "income_bonus_id": UUID("bbbbbbbb-3333-4333-8333-333333333333"),
        "expense_bonus_id": UUID("bbbbbbbb-4444-4444-8444-444444444444"),
        "spaced_dining_id": UUID("bbbbbbbb-5555-4555-8555-555555555555"),
        "plain_dining_id": UUID("bbbbbbbb-6666-4666-8666-666666666666"),
        "group_grocery_id": UUID("bbbbbbbb-7777-4777-8777-777777777777"),
        "older_adjustment_id": UUID("bbbbbbbb-8888-4888-8888-888888888888"),
        "newer_adjustment_id": UUID("bbbbbbbb-9999-4999-8999-999999999999"),
        "older_grocery_transaction_id": UUID("cccccccc-1111-4111-8111-111111111111"),
        "newer_grocery_transaction_id": UUID("cccccccc-2222-4222-8222-222222222222"),
        "income_bonus_transaction_id": UUID("cccccccc-3333-4333-8333-333333333333"),
        "expense_bonus_transaction_id": UUID("cccccccc-4444-4444-8444-444444444444"),
        "adjustment_transaction_id": UUID("cccccccc-5555-4555-8555-555555555555"),
        "base_budget_id": UUID("dddddddd-1111-4111-8111-111111111111"),
    }

    # Each pair is stamped a day apart, so which one the fold keeps is settled by the data rather
    # than by the order the rows happen to come back in
    first_day = datetime(2026, 1, 1, tzinfo=UTC)
    second_day = datetime(2026, 1, 2, tzinfo=UTC)
    categories = [
        (ids["older_grocery_id"], ids["user_id"], None, "Groceries", "EXPENSE", first_day),
        (ids["newer_grocery_id"], ids["user_id"], None, "GROCERIES", "EXPENSE", second_day),
        (ids["income_bonus_id"], ids["user_id"], None, "Bonus", "INCOME", first_day),
        (ids["expense_bonus_id"], ids["user_id"], None, "bonus", "EXPENSE", second_day),
        (ids["spaced_dining_id"], ids["user_id"], None, "Dining ", "EXPENSE", first_day),
        (ids["plain_dining_id"], ids["user_id"], None, "Dining", "EXPENSE", second_day),
        (ids["group_grocery_id"], None, ids["group_id"], "Groceries", "EXPENSE", first_day),
        (ids["older_adjustment_id"], ids["user_id"], None, "Balance Adjustment", "TRANSFER", first_day),
        (ids["newer_adjustment_id"], ids["user_id"], None, "BALANCE ADJUSTMENT", "TRANSFER", second_day),
    ]

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                " VALUES ('CAD', 'Canadian Dollar', '$', 2)",
            ))
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-folded@example.com', 'Migration', 'America/Toronto', 'CAD')",
                ),
                {"user_id": ids["user_id"]},
            )
            await conn.execute(
                text("INSERT INTO groups (id, owner_id, name) VALUES (:group_id, :user_id, 'Household')"),
                {"group_id": ids["group_id"], "user_id": ids["user_id"]},
            )
            for account_id, account_name in (
                (ids["account_id"], "Chequing"),
                (ids["counterparty_account_id"], "Savings"),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO accounts"
                        " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                        " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', :name, 'CAD', false)",
                    ),
                    {"account_id": account_id, "user_id": ids["user_id"], "name": account_name},
                )

            for category_id, owner_id, group_id, name, kind, created_at in categories:
                await conn.execute(
                    text(
                        "INSERT INTO categories (id, owner_id, group_id, name, kind, is_system, created_at)"
                        " VALUES (:id, :owner_id, :group_id, :name, :kind, false, :created_at)",
                    ),
                    {
                        "id": category_id,
                        "owner_id": owner_id,
                        "group_id": group_id,
                        "name": name,
                        "kind": kind,
                        "created_at": created_at,
                    },
                )

            for transaction_id, category_id in (
                (ids["older_grocery_transaction_id"], ids["older_grocery_id"]),
                (ids["newer_grocery_transaction_id"], ids["newer_grocery_id"]),
                (ids["income_bonus_transaction_id"], ids["income_bonus_id"]),
                (ids["expense_bonus_transaction_id"], ids["expense_bonus_id"]),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO transactions"
                        " (id, created_by_user_id, account_id, dt, category_id, amount, currency)"
                        " VALUES (:id, :user_id, :account_id, '2026-03-15', :category_id, -2500, 'CAD')",
                    ),
                    {
                        "id": transaction_id,
                        "user_id": ids["user_id"],
                        "account_id": ids["account_id"],
                        "category_id": category_id,
                    },
                )

            # Filed under the later spelling of Balance Adjustment, which does record a counterparty
            # account because its name is not the one the rule names
            await conn.execute(
                text(
                    "INSERT INTO transactions"
                    " (id, created_by_user_id, account_id, dt, category_id, amount, currency,"
                    " counterparty_account_id, counterparty_account_scope)"
                    " VALUES (:id, :user_id, :account_id, '2026-03-16', :category_id, -1000, 'CAD',"
                    " :counterparty_account_id, 'TRACKED')",
                ),
                {
                    "id": ids["adjustment_transaction_id"],
                    "user_id": ids["user_id"],
                    "account_id": ids["account_id"],
                    "category_id": ids["newer_adjustment_id"],
                    "counterparty_account_id": ids["counterparty_account_id"],
                },
            )

            await conn.execute(
                text(
                    "INSERT INTO base_budgets"
                    " (id, owner_id, name, currency, recurrence_freq, instance_length, recurs, is_archived)"
                    " VALUES (:id, :user_id, 'Monthly', 'CAD', 'MONTHLY', 1, true, false)",
                ),
                {"id": ids["base_budget_id"], "user_id": ids["user_id"]},
            )

            # Tracking both spellings, so the fold has to drop one rather than move it onto a budget
            # already tracking the survivor
            for category_id in (ids["older_grocery_id"], ids["newer_grocery_id"]):
                await conn.execute(
                    text(
                        "INSERT INTO budget_tracked_categories (id, base_budget_id, category_id, added_at)"
                        " VALUES (gen_random_uuid(), :budget_id, :category_id, '2026-01-01')",
                    ),
                    {"budget_id": ids["base_budget_id"], "category_id": category_id},
                )
    finally:
        await engine.dispose()

    return ids


async def _seed_merchants_differing_only_in_capitals(database_name: str) -> dict[str, UUID]:
    """Insert two personal merchants spelled differently, each carrying a transaction

    Returns:
        The identifiers the fold is judged against
    """
    ids = {
        "user_id": UUID("eeeeeeee-1111-4111-8111-111111111111"),
        "account_id": UUID("eeeeeeee-2222-4222-8222-222222222222"),
        "category_id": UUID("eeeeeeee-3333-4333-8333-333333333333"),
        "older_merchant_id": UUID("ffffffff-1111-4111-8111-111111111111"),
        "newer_merchant_id": UUID("ffffffff-2222-4222-8222-222222222222"),
        "older_transaction_id": UUID("ffffffff-3333-4333-8333-333333333333"),
        "newer_transaction_id": UUID("ffffffff-4444-4444-8444-444444444444"),
    }

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                " VALUES ('CAD', 'Canadian Dollar', '$', 2)",
            ))
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-folded-merchant@example.com', 'Migration',"
                    " 'America/Toronto', 'CAD')",
                ),
                {"user_id": ids["user_id"]},
            )
            await conn.execute(
                text(
                    "INSERT INTO accounts"
                    " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                    " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Chequing', 'CAD', false)",
                ),
                {"account_id": ids["account_id"], "user_id": ids["user_id"]},
            )
            await conn.execute(
                text(
                    "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                    " VALUES (:category_id, :user_id, 'Shopping', 'EXPENSE', false)",
                ),
                {"category_id": ids["category_id"], "user_id": ids["user_id"]},
            )

            # A day apart, so the older spelling is the one the fold keeps rather than whichever row
            # the database returns first
            for merchant_id, name, created_at in (
                (ids["older_merchant_id"], "Amazon", datetime(2026, 1, 1, tzinfo=UTC)),
                (ids["newer_merchant_id"], "AMAZON", datetime(2026, 1, 2, tzinfo=UTC)),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO merchants (id, owner_id, name, created_at)"
                        " VALUES (:id, :user_id, :name, :created_at)",
                    ),
                    {"id": merchant_id, "user_id": ids["user_id"], "name": name, "created_at": created_at},
                )

            for transaction_id, merchant_id in (
                (ids["older_transaction_id"], ids["older_merchant_id"]),
                (ids["newer_transaction_id"], ids["newer_merchant_id"]),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO transactions"
                        " (id, created_by_user_id, account_id, dt, merchant_id, category_id, amount, currency)"
                        " VALUES (:id, :user_id, :account_id, '2026-03-15', :merchant_id, :category_id,"
                        " -2500, 'CAD')",
                    ),
                    {
                        "id": transaction_id,
                        "user_id": ids["user_id"],
                        "account_id": ids["account_id"],
                        "merchant_id": merchant_id,
                        "category_id": ids["category_id"],
                    },
                )
    finally:
        await engine.dispose()

    return ids
