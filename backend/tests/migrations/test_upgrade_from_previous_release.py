"""Upgrading a database from the last release, from before bank connections, to the current schema

Stands in for a v0.14.2 database: built to the current schema, migrated back to its revision, and
cleared of the set helpers it never had. Its other helpers keep their current text. That text adds to
v0.14.2's without changing any signature, and the database holds no data
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic, _run_alembic_upgrade

_DB_NAME = f"{WORKER_DB_NAME}_alembic_previous_release"
_PREVIOUS_RELEASE_REVISION = "8d3f6a1c4e72"

# The first revision after it that secures a table with a rule testing a set
_BANK_CONNECTIONS_REVISION = "5b8e2d4f7a13"

_SET_HELPERS = ("administered_group_ids", "accessible_group_ids", "accessible_account_ids", "accessible_base_budget_ids")


async def _set_helpers(conn: AsyncConnection) -> set[str]:
    """Return which set helpers the database has"""
    rows = await conn.execute(text("SELECT proname FROM pg_proc WHERE proname = ANY(:names)"), {"names": list(_SET_HELPERS)})
    return {row.proname for row in rows}


async def test_a_database_from_the_previous_release_upgrades_to_the_current_schema() -> None:
    """The first table secured after the last release gets the set helpers its rule names, and the upgrade completes"""
    await _recreate_database(_DB_NAME)
    engine = _create_engine_for_database(_DB_NAME)
    try:
        _run_alembic_upgrade(_DB_NAME)
        completed = _run_alembic(_DB_NAME, "downgrade", _PREVIOUS_RELEASE_REVISION)
        assert completed.returncode == 0, completed.stdout + completed.stderr
        async with engine.begin() as conn:
            for helper in _SET_HELPERS:
                await conn.execute(text(f"DROP FUNCTION public.{helper}()"))
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT version_num FROM alembic_version")) == _PREVIOUS_RELEASE_REVISION
            assert await _set_helpers(conn) == set()

        _run_alembic_upgrade(_DB_NAME, revision=_BANK_CONNECTIONS_REVISION)
        async with engine.connect() as conn:
            assert await _set_helpers(conn) == set(_SET_HELPERS)

        _run_alembic_upgrade(_DB_NAME)
    finally:
        await engine.dispose()
        await _drop_database(_DB_NAME)
