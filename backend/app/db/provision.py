"""Create database roles and transfer schema ownership to the migrator"""

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.config.database import APP_DB_USER, DB_NAME, MIGRATOR_DB_USER, admin_database_url, migration_database_url
from app.db.credentials import resolve_role_password
from app.db.rls import apply_rls, revoke_rls

# Least-privilege attributes both managed roles are created with. They are set only at creation,
# since a role without superuser rights may not name SUPERUSER or BYPASSRLS in any ALTER ROLE, even
# to turn them off. A later run refuses a role that no longer has them instead of repairing it
_ROLE_ATTRIBUTES = "LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS"

# What each managed role must still hold on every run: the pg_roles column, the value it must have,
# the attribute's name and the clause that restores it. LOGIN is checked too, since a role that
# cannot sign in leaves the app unable to connect
_REQUIRED_ATTRIBUTES = (
    ("rolsuper", False, "SUPERUSER", "NOSUPERUSER"),
    ("rolbypassrls", False, "BYPASSRLS", "NOBYPASSRLS"),
    ("rolcreaterole", False, "CREATEROLE", "NOCREATEROLE"),
    ("rolcreatedb", False, "CREATEDB", "NOCREATEDB"),
    ("rolcanlogin", True, "LOGIN", "LOGIN"),
)

# Role key passed to the password resolver paired with the role name it provisions
_MANAGED_ROLES = (("migrator", MIGRATOR_DB_USER), ("app", APP_DB_USER))

# Session setting that carries a password to the statement that applies it. A custom setting name
# needs a dot, and this one is read only in this connection
_CREDENTIAL_SETTING = "lumina.role_credential"

# Longest one statement of the app role may run before the database cancels it and releases its
# locks. The slowest statement of a maximum-size import, export or account deletion takes a few
# seconds, so this leaves room for much slower hardware. The migrator and the admin login get no
# limit, since a migration or a backup may run far longer
APP_STATEMENT_TIMEOUT_SECONDS = 60

# Longest the app role may hold a transaction open with no statement running before the database
# ends its connection. As long as the longest the app's own screens wait for an answer, an import,
# so nothing a screen still waits for is cut off, such as an export the client reads slowly or a
# bank provider answering slowly while a connection is being claimed
APP_IDLE_IN_TRANSACTION_TIMEOUT_SECONDS = 5 * 60


def _create_admin_engine():
    """Return an engine for the admin login that keeps statement parameters out of its errors"""
    return create_async_engine(admin_database_url(), isolation_level="AUTOCOMMIT", hide_parameters=True)


async def _create_missing_roles(conn: AsyncConnection) -> None:
    """Create each managed role that does not exist yet with the least-privilege attributes"""
    for _, role_name in _MANAGED_ROLES:
        await conn.execute(
            text(
                f"DO $$ BEGIN "
                f"IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role_name}') THEN "
                f'CREATE ROLE "{role_name}" WITH {_ROLE_ATTRIBUTES}; '
                f"END IF; END $$"
            )
        )


async def _refuse_drifted_roles(conn: AsyncConnection) -> None:
    """Refuse to go on while a managed role no longer has the attributes it was created with

    Raises:
        RuntimeError: A role has SUPERUSER, BYPASSRLS, CREATEROLE or CREATEDB, or lacks LOGIN,
            naming each role and attribute and the statement that restores it
    """
    problems = []
    fixes = []
    for _, role_name in _MANAGED_ROLES:
        row = (await conn.execute(text("SELECT * FROM pg_roles WHERE rolname = :role"), {"role": role_name})).mappings().one()
        for column, required, attribute, restoring_clause in _REQUIRED_ATTRIBUTES:
            if row[column] != required:
                problems.append(f'"{role_name}" {"has" if row[column] else "lacks"} {attribute}')
                fixes.append(f'ALTER ROLE "{role_name}" {restoring_clause}')
    if problems:
        raise RuntimeError(
            f"Refusing to set up the database roles because {', '.join(problems)}. "
            "Set-up gives a role its attributes only when it creates the role. "
            f"A database administrator can restore them by running {', '.join(fixes)}"
        )


async def _set_password(conn: AsyncConnection, role_name: str, password: str) -> None:
    """Set a role's password without the password appearing in any statement the database can log

    The password travels as a bound value to a statement that cannot fail, and the statement that
    applies it reads it back on the server. That statement's own failure is caught and raised again
    without its text, since the database logs the text of the statement that failed, password included
    """
    await conn.execute(text("SELECT set_config(:setting, :password, false)"), {"setting": _CREDENTIAL_SETTING, "password": password})
    try:
        await conn.execute(
            text(
                "DO $$ DECLARE detail text; BEGIN "
                f"EXECUTE format('ALTER ROLE %I PASSWORD %L', '{role_name}', current_setting('{_CREDENTIAL_SETTING}')); "
                "EXCEPTION WHEN OTHERS THEN "
                "GET STACKED DIAGNOSTICS detail = PG_EXCEPTION_DETAIL; "
                f"RAISE EXCEPTION 'Could not set the password of the database role \"%\": %', '{role_name}', SQLERRM "
                "USING ERRCODE = SQLSTATE, DETAIL = detail; "
                "END $$"
            )
        )
    finally:
        await conn.execute(text("SELECT set_config(:setting, '', false)"), {"setting": _CREDENTIAL_SETTING})


async def _verify_baseline_access(conn: AsyncConnection) -> None:
    """Confirm the roles hold the access the grants are meant to give them

    A grant by a role that does not own the schema or the database only warns and changes nothing,
    and the database may already give the access to everyone, so the privilege itself is what is read

    Raises:
        RuntimeError: A role lacks schema or database access, naming it
    """
    missing = [
        description
        for description, check in (
            (f'CREATE on schema public for "{MIGRATOR_DB_USER}"', f"has_schema_privilege('{MIGRATOR_DB_USER}', 'public', 'CREATE')"),
            (f'USAGE on schema public for "{APP_DB_USER}"', f"has_schema_privilege('{APP_DB_USER}', 'public', 'USAGE')"),
            (f'CONNECT on database "{DB_NAME}" for "{APP_DB_USER}"', f"has_database_privilege('{APP_DB_USER}', current_database(), 'CONNECT')"),
        )
        if not await conn.scalar(text(f"SELECT {check}"))
    ]
    if missing:
        raise RuntimeError(
            f"The admin login could not grant the database roles their access, so they lack {', '.join(missing)}. "
            "The admin must own the database and the public schema, or hold these privileges with grant option"
        )


async def ensure_roles() -> None:
    """Create the migrator and app roles and grant their baseline access

    Works for an admin login with or without superuser rights. Role attributes are set only when a
    role is created. Each run refuses a role that has drifted, then sets both
    passwords, grants and reads back the baseline access, and sets the app role's two limits again
    """
    engine = _create_admin_engine()
    try:
        async with engine.connect() as conn:
            await _create_missing_roles(conn)
            await _refuse_drifted_roles(conn)
            for role_key, role_name in _MANAGED_ROLES:
                await _set_password(conn, role_name, resolve_role_password(role_key, generate=True))

            # The migrator owns and builds the schema, the app role only connects
            # and reads it, its table privileges arrive later with the RLS policies
            await conn.execute(text(f'GRANT CREATE, USAGE ON SCHEMA public TO "{MIGRATOR_DB_USER}"'))
            await conn.execute(text(f'GRANT CONNECT ON DATABASE "{DB_NAME}" TO "{APP_DB_USER}"'))
            await conn.execute(text(f'GRANT USAGE ON SCHEMA public TO "{APP_DB_USER}"'))
            await _verify_baseline_access(conn)

            # Role settings reach every connection the role opens from now on, whatever opens it,
            # and apply again on every start, so a changed limit replaces the old one
            await conn.execute(text(f"ALTER ROLE \"{APP_DB_USER}\" SET statement_timeout = '{APP_STATEMENT_TIMEOUT_SECONDS}s'"))
            await conn.execute(
                text(f"ALTER ROLE \"{APP_DB_USER}\" SET idle_in_transaction_session_timeout = '{APP_IDLE_IN_TRANSACTION_TIMEOUT_SECONDS}s'")
            )
    finally:
        await engine.dispose()


# For each kind of object in the public schema, a query listing one statement per object the
# migrator does not own yet. Names come back quoted by the database. Each query runs only once the
# kinds before it are moved, so a sequence a table owns is moved along with the table and not listed.
# Only the fixed migrator role name is interpolated, so this is safe
_OWNERSHIP_STATEMENTS = (
    # Tables, partitioned ones included
    f"SELECT format('ALTER TABLE public.%I OWNER TO %I', c.relname, '{MIGRATOR_DB_USER}') FROM pg_class c "  # noqa: S608
    "JOIN pg_namespace n ON n.oid = c.relnamespace "
    f"WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) <> '{MIGRATOR_DB_USER}'",
    f"SELECT format('ALTER SEQUENCE public.%I OWNER TO %I', c.relname, '{MIGRATOR_DB_USER}') FROM pg_class c "  # noqa: S608
    "JOIN pg_namespace n ON n.oid = c.relnamespace "
    f"WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> '{MIGRATOR_DB_USER}'",
    # Functions are reassigned by full signature so overloaded names stay distinct
    f"SELECT format('ALTER FUNCTION %s OWNER TO %I', p.oid::regprocedure::text, '{MIGRATOR_DB_USER}') FROM pg_proc p "  # noqa: S608
    "JOIN pg_namespace n ON n.oid = p.pronamespace "
    f"WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> '{MIGRATOR_DB_USER}'",
    # Enum types are reassigned so the migrator can alter them, such as adding an enum value
    f"SELECT format('ALTER TYPE public.%I OWNER TO %I', t.typname, '{MIGRATOR_DB_USER}') FROM pg_type t "  # noqa: S608
    "JOIN pg_namespace n ON n.oid = t.typnamespace "
    f"WHERE n.nspname = 'public' AND t.typtype = 'e' AND pg_get_userbyid(t.typowner) <> '{MIGRATOR_DB_USER}'",
)


async def _allow_admin_to_act_as_migrator(conn: AsyncConnection) -> None:
    """Let the admin change owners to the migrator, which takes the right to act as it

    A superuser may already. A role without superuser rights that created the migrator holds only
    the right to administer it, so it grants itself membership, once and without effect on a later run
    """
    # USAGE reads the same on every PostgreSQL version, where the SET privilege exists only from 16
    can_act = await conn.scalar(text(f"SELECT pg_has_role(current_user, '{MIGRATOR_DB_USER}', 'USAGE')"))
    if not can_act:
        await conn.execute(text(f'GRANT "{MIGRATOR_DB_USER}" TO CURRENT_USER'))


async def transfer_schema_ownership() -> None:
    """Transfer every public table, sequence, function, and enum type the migrator lacks to the migrator role

    A restored dump owns these as the restoring role, while migrations and the row-level
    security re-apply run as the migrator and must own the objects they change. Enum types are
    included so a later migration can alter one, such as adding an enum value. An object the migrator
    already owns is left alone, since changing an owner locks its table even when the owner stays the
    same, so this step takes no table lock when there is nothing to move
    """
    engine = _create_admin_engine()
    try:
        async with engine.connect() as conn:
            can_act_as_migrator = False
            for query in _OWNERSHIP_STATEMENTS:
                statements = (await conn.scalars(text(query))).all()
                if statements and not can_act_as_migrator:
                    await _allow_admin_to_act_as_migrator(conn)
                    can_act_as_migrator = True
                for statement in statements:
                    await conn.exec_driver_sql(statement)
    finally:
        await engine.dispose()


def _reapply_row_level_security(sync_connection) -> None:
    """Drop and rebuild every policy and app role grant in one transaction"""
    revoke_rls(sync_connection)
    apply_rls(sync_connection)


async def apply_row_level_security() -> None:
    """Rebuild row-level security so a restored dump regains its app role grants

    Every policy is dropped and rebuilt, which locks every table until the rebuild commits

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
