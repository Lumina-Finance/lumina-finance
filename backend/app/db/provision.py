"""Create database roles and transfer schema ownership to the migrator"""

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import APP_DB_USER, DB_NAME, MIGRATOR_DB_USER, admin_database_url, migration_database_url
from app.db.credentials import resolve_role_password
from app.db.rls import apply_rls, revoke_rls

# Least-privilege attributes shared by both managed roles. NOBYPASSRLS is stated
# explicitly so re-provisioning resets any role that was granted the bypass by hand
_ROLE_ATTRIBUTES = "LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS"

# Role key passed to the password resolver paired with the role name it provisions
_MANAGED_ROLES = (("migrator", MIGRATOR_DB_USER), ("app", APP_DB_USER))


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


async def transfer_schema_ownership() -> None:
    """Transfer every public table, sequence, function, and enum type to the migrator role

    A restored dump owns these as the restoring superuser, while migrations and the row-level
    security re-apply run as the migrator and must own the objects they change. Enum types are
    included so a later migration can alter one, such as adding an enum value
    """
    engine = create_async_engine(admin_database_url(), isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            # Only the fixed migrator role name is interpolated, so this is safe
            await conn.execute(text(
                "DO $$ DECLARE object_name text; BEGIN "  # noqa: S608
                "FOR object_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP "
                f"EXECUTE format('ALTER TABLE public.%I OWNER TO %I', object_name, '{MIGRATOR_DB_USER}'); "
                "END LOOP; "
                "FOR object_name IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP "
                f"EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', object_name, '{MIGRATOR_DB_USER}'); "
                "END LOOP; END $$"
            ))

            # Functions are reassigned by full signature so overloaded names stay distinct
            await conn.execute(text(
                "DO $$ DECLARE function_signature text; BEGIN "  # noqa: S608
                "FOR function_signature IN "
                "SELECT p.oid::regprocedure::text FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP "
                f"EXECUTE format('ALTER FUNCTION %s OWNER TO %I', function_signature, '{MIGRATOR_DB_USER}'); "
                "END LOOP; END $$"
            ))

            # Enum types are reassigned so the migrator can alter them, such as adding an enum value
            await conn.execute(text(
                "DO $$ DECLARE type_name text; BEGIN "  # noqa: S608
                "FOR type_name IN SELECT t.typname FROM pg_type t "
                "JOIN pg_namespace n ON n.oid = t.typnamespace "
                "WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP "
                f"EXECUTE format('ALTER TYPE public.%I OWNER TO %I', type_name, '{MIGRATOR_DB_USER}'); "
                "END LOOP; END $$"
            ))
    finally:
        await engine.dispose()


def _reapply_row_level_security(sync_connection) -> None:
    """Drop and rebuild every policy and app role grant in one transaction"""
    revoke_rls(sync_connection)
    apply_rls(sync_connection)


async def apply_row_level_security() -> None:
    """Rebuild row-level security so a restored dump regains its app role grants

    A development restore strips ACLs and arrives at migration head, so the bootstrap
    RLS migration never re-runs, this re-applies the policies and grants from the app
    source as the migrator that owns the schema
    """
    engine = create_async_engine(migration_database_url())
    try:
        async with engine.begin() as connection:
            await connection.run_sync(_reapply_row_level_security)
    finally:
        await engine.dispose()


_COMMANDS = {
    "ensure-roles": ensure_roles,
    "transfer-ownership": transfer_schema_ownership,
    "apply-rls": apply_row_level_security,
}


def main() -> None:
    """Run the provisioning command named as the single command-line argument"""
    if len(sys.argv) != 2 or sys.argv[1] not in _COMMANDS:
        sys.exit(f"Usage: python -m app.db.provision {{{'|'.join(_COMMANDS)}}}")
    asyncio.run(_COMMANDS[sys.argv[1]]())


if __name__ == "__main__":
    main()
