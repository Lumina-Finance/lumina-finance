"""Create database roles and transfer schema ownership to the migrator"""

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import APP_DB_USER, DB_NAME, MIGRATOR_DB_USER, admin_database_url
from app.db.credentials import resolve_role_password

# Least-privilege attributes shared by both managed roles
_ROLE_ATTRIBUTES = "LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB"

# Role key passed to the password resolver paired with the role name it provisions
_MANAGED_ROLES = (("migrator", MIGRATOR_DB_USER), ("app", APP_DB_USER))

# Reassign every public table and sequence to the migrator. Only the fixed
# migrator role name is interpolated, so this is not an injection vector
_TRANSFER_OWNERSHIP_SQL = (
    "DO $$ DECLARE object_name text; BEGIN "  # noqa: S608

    "FOR object_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP "
    f"EXECUTE format('ALTER TABLE public.%I OWNER TO %I', object_name, '{MIGRATOR_DB_USER}'); "
    "END LOOP; "
    "FOR object_name IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP "
    f"EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', object_name, '{MIGRATOR_DB_USER}'); "
    "END LOOP; END $$"
)


def _quote_literal(value: str) -> str:
    """Return a value as a single-quoted SQL string literal

    Args:
        value: Raw value to quote

    Returns:
        The value wrapped in single quotes with internal quotes doubled
    """
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


async def ensure_roles() -> None:
    """Create the migrator and app roles and grant their baseline access"""
    engine = create_async_engine(admin_database_url(), isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            for role_key, role_name in _MANAGED_ROLES:
                password = resolve_role_password(role_key, generate=True)
                await conn.execute(text(
                    f"DO $$ BEGIN "
                    f"IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role_name}') THEN "
                    f'CREATE ROLE "{role_name}" WITH {_ROLE_ATTRIBUTES}; '
                    f"END IF; END $$"
                ))
                await conn.execute(text(
                    f'ALTER ROLE "{role_name}" WITH {_ROLE_ATTRIBUTES} PASSWORD {_quote_literal(password)}'
                ))

            # The migrator owns and builds the schema, the app role only connects
            # and reads it, its table privileges arrive later with the RLS policies
            await conn.execute(text(f'GRANT CREATE, USAGE ON SCHEMA public TO "{MIGRATOR_DB_USER}"'))
            await conn.execute(text(f'GRANT CONNECT ON DATABASE "{DB_NAME}" TO "{APP_DB_USER}"'))
            await conn.execute(text(f'GRANT USAGE ON SCHEMA public TO "{APP_DB_USER}"'))
    finally:
        await engine.dispose()


async def transfer_table_ownership() -> None:
    """Transfer every public table and sequence to the migrator role"""
    engine = create_async_engine(admin_database_url(), isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            await conn.execute(text(_TRANSFER_OWNERSHIP_SQL))
    finally:
        await engine.dispose()


_COMMANDS = {
    "ensure-roles": ensure_roles,
    "transfer-ownership": transfer_table_ownership,
}


def main() -> None:
    """Run the provisioning command named as the single command-line argument"""
    if len(sys.argv) != 2 or sys.argv[1] not in _COMMANDS:
        sys.exit(f"Usage: python -m app.db.provision {{{'|'.join(_COMMANDS)}}}")
    asyncio.run(_COMMANDS[sys.argv[1]]())


if __name__ == "__main__":
    main()
