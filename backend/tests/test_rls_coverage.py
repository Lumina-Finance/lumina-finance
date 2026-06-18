"""Guard tests ensuring every table is covered by row-level security"""

from sqlalchemy import text

from app.db.rls import _AUTH_TABLES, _GLOBAL_READ_TABLES
from app.models.base import Base
from tests.conftest import engine

# Tables intentionally left out of row-level security, sourced from rls.py so the
# guard and the policy definition can never drift apart
_RLS_EXEMPT_TABLES = frozenset(_GLOBAL_READ_TABLES) | frozenset(_AUTH_TABLES)


async def _rls_enabled_tables() -> set[str]:
    """Return the names of public tables that have row-level security enabled"""
    async with engine.connect() as conn:
        return set(
            await conn.scalars(text(
                "SELECT c.relname FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity"
            ))
        )


async def test_every_table_is_rls_protected_or_exempt():
    """Fail when a model table has neither row-level security nor an explicit exemption"""
    enabled = await _rls_enabled_tables()
    uncovered = [
        table.name
        for table in Base.metadata.sorted_tables
        if table.name not in _RLS_EXEMPT_TABLES and table.name not in enabled
    ]
    assert not uncovered, f"Tables missing row-level security or an explicit exemption: {uncovered}"


def test_rls_exemptions_reference_existing_tables():
    """Fail when the exemption list names a table that no longer exists"""
    known_tables = {table.name for table in Base.metadata.sorted_tables}
    stale = _RLS_EXEMPT_TABLES - known_tables
    assert not stale, f"Exempt tables that no longer exist: {stale}"
