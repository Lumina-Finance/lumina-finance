"""Guard tests ensuring every table is covered by row-level security"""

from sqlalchemy import text

from app.config import APP_DB_USER
from app.db.rls import AUTH_TABLES, GLOBAL_READ_TABLES
from app.models.base import Base
from tests.conftest import engine

# Tables intentionally left out of row-level security, sourced from the rls package so
# the guard and the policy definition can never drift apart
_RLS_EXEMPT_TABLES = frozenset(GLOBAL_READ_TABLES) | frozenset(AUTH_TABLES)


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


async def test_app_role_cannot_bypass_row_level_security():
    """Fail when the app role could bypass policies as a superuser, BYPASSRLS, or table owner"""
    async with engine.connect() as conn:
        attributes = (await conn.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = :role"),
            {"role": APP_DB_USER},
        )).one_or_none()
        assert attributes is not None, f"App role {APP_DB_USER!r} does not exist"

        is_superuser, bypasses_rls = attributes
        assert not is_superuser, f"App role {APP_DB_USER!r} is a superuser and bypasses row-level security"
        assert not bypasses_rls, f"App role {APP_DB_USER!r} has the BYPASSRLS attribute"

        # Owners bypass their own tables' policies unless FORCE is set, so the app role
        # must own none of the secured tables
        owned_table_count = await conn.scalar(
            text(
                "SELECT count(*) FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "JOIN pg_roles r ON r.oid = c.relowner "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = :role"
            ),
            {"role": APP_DB_USER},
        )
        assert owned_table_count == 0, f"App role {APP_DB_USER!r} owns {owned_table_count} public tables"
