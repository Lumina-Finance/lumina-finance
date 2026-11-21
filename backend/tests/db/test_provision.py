"""Role provisioning tests against a real PostgreSQL server

The admin login that runs set-up may or may not be a superuser, so these tests run it on a server of
their own, with a login of each kind (tests/db/conftest.py). Each test gets a database of its own
"""

import os
import secrets
import traceback

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from app import database
from app.config.database import APP_DB_USER, MIGRATOR_DB_USER
from app.db import credentials, provision
from app.db.rls import apply_rls
from app.models.base import Base
from tests.db.support import (
    APP_PASSWORD,
    LOGIN_PASSWORD,
    MIGRATOR_PASSWORD,
    RESTRICTED_ADMIN_LOGIN,
    SUPERUSER_LOGIN,
    Target,
    query,
    run_module,
)

_NEW_APP_PASSWORD = "a-new:password"

# A password no error message or log line may ever hold
_SECRET = "Zq9-never-in-a-log"

_ADMIN_LOGINS = pytest.mark.parametrize("admin_login", [SUPERUSER_LOGIN, RESTRICTED_ADMIN_LOGIN], ids=["superuser", "without-superuser"])


async def _build_schema_as(engine: AsyncEngine) -> None:
    """Build the app's tables, sequences, enum types and row-level security helpers as the engine's login

    A restored dump arrives owned by the role that restored it, and this stands in for one
    """
    async with engine.connect() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.run_sync(apply_rls)
    await engine.dispose()


def _migrate_as_migrator(target: Target) -> None:
    """Run every migration against the database in a process of its own, as the migrator the app uses"""
    environment = {
        **os.environ,
        **target.environment(
            MIGRATOR_DB_PASSWORD=MIGRATOR_PASSWORD, APP_DB_PASSWORD=APP_PASSWORD, BANK_TRANSACTION_HASH_KEY=secrets.token_hex(32)
        ),
    }
    completed = run_module("alembic", "upgrade", "head", environment=environment)
    assert completed.returncode == 0, completed.stdout + completed.stderr


# Counts the public objects the migrator does not own, and a finished transfer leaves none
_NOT_OWNED_BY_MIGRATOR = """
    SELECT count(*) FROM (
        SELECT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
        UNION ALL SELECT pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
        UNION ALL SELECT pg_get_userbyid(t.typowner) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public' AND t.typtype = 'e'
    ) owners WHERE owner <> '{migrator}'
"""


@_ADMIN_LOGINS
async def test_set_up_of_a_new_database_starts_the_app_as_the_unprivileged_role(provision_into, admin_login, monkeypatch):
    """A fresh install and a later start both succeed, and the app then runs as the role the policies bind

    Set-up runs as the container's entrypoint does, a second time with a new app password to show an
    up-to-date database only has its password set again
    """
    async with provision_into(admin_login) as target:
        await provision.ensure_roles()
        await provision.transfer_schema_ownership()
        _migrate_as_migrator(target)
        await provision.apply_row_level_security()

        monkeypatch.setenv("APP_DB_PASSWORD", _NEW_APP_PASSWORD)
        await provision.ensure_roles()
        await provision.transfer_schema_ownership()

        app_engine = target.engine(APP_DB_USER, _NEW_APP_PASSWORD)
        monkeypatch.setattr(database, "engine", app_engine)
        await database.verify_app_role_is_unprivileged()
        assert await query(app_engine, "SHOW statement_timeout") == "1min", "the app role's statement limit applies"
        assert await query(app_engine, "SHOW idle_in_transaction_session_timeout") == "5min", "the app role's idle limit applies"
        assert await query(app_engine, "SELECT count(*) FROM users") == 0, "the app role reads the tables it was granted"
        migrator_engine = target.engine(MIGRATOR_DB_USER, MIGRATOR_PASSWORD)
        assert await query(migrator_engine, "SELECT current_user") == MIGRATOR_DB_USER, "the migrator signs in with its password"


async def test_a_restored_dump_is_handed_to_the_migrator_by_an_admin_without_superuser_rights(provision_into):
    """After a restore every object is owned by the restoring admin, and each moves to the migrator"""
    async with provision_into(RESTRICTED_ADMIN_LOGIN) as target:
        await provision.ensure_roles()
        await _build_schema_as(target.engine(RESTRICTED_ADMIN_LOGIN, LOGIN_PASSWORD))
        assert await query(target.superuser(), _NOT_OWNED_BY_MIGRATOR.format(migrator=MIGRATOR_DB_USER)) > 0, "the dump starts admin-owned"

        await provision.transfer_schema_ownership()
        await provision.apply_row_level_security()

        assert await query(target.superuser(), _NOT_OWNED_BY_MIGRATOR.format(migrator=MIGRATOR_DB_USER)) == 0, (
            "every table, sequence, function and enum type now belongs to the migrator"
        )
        app_engine = target.engine(APP_DB_USER, APP_PASSWORD)
        assert await query(app_engine, "SELECT count(*) FROM users") == 0, "the policies and grants were rebuilt for the app role"


async def test_ownership_transfer_with_nothing_to_move_waits_for_no_table_lock(provision_into):
    """Changing an owner locks its table even when the owner stays the same, so the transfer must leave owned tables alone

    The rebuild of the policies that follows on every start still locks every table, so this holds for
    the admin's two steps only

    The migrator holds the heaviest lock on a table, as a running migration would, and the admin cancels
    any statement that waits for a lock, so a run that reached the table fails
    """
    async with provision_into(RESTRICTED_ADMIN_LOGIN) as target:
        await provision.ensure_roles()
        await _build_schema_as(target.engine(RESTRICTED_ADMIN_LOGIN, LOGIN_PASSWORD))
        await provision.transfer_schema_ownership()

        holder = target.engine(MIGRATOR_DB_USER, MIGRATOR_PASSWORD, autocommit=False)
        async with holder.connect() as connection, connection.begin():
            await connection.execute(text("LOCK TABLE users IN ACCESS EXCLUSIVE MODE"))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await query(target.engine(RESTRICTED_ADMIN_LOGIN, LOGIN_PASSWORD), f'ALTER TABLE users OWNER TO "{MIGRATOR_DB_USER}"')
            await provision.ensure_roles()
            await provision.transfer_schema_ownership()
        await holder.dispose()


@pytest.mark.parametrize(
    ("admin_login", "role", "column", "attribute", "drifted_to"),
    [
        (RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolsuper", "SUPERUSER", True),
        (RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolbypassrls", "BYPASSRLS", True),
        (RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolcreaterole", "CREATEROLE", True),
        (RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolcreatedb", "CREATEDB", True),
        (RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolcanlogin", "LOGIN", False),
        (RESTRICTED_ADMIN_LOGIN, MIGRATOR_DB_USER, "rolbypassrls", "BYPASSRLS", True),
        (SUPERUSER_LOGIN, APP_DB_USER, "rolbypassrls", "BYPASSRLS", True),
    ],
)
async def test_a_role_that_drifted_stops_set_up_with_its_name_and_attribute_and_changes_nothing(
    provision_into, admin_login, role, column, attribute, drifted_to, monkeypatch
):
    """A role someone altered by hand is refused, even by a superuser admin that could repair it, and no password changes"""
    async with provision_into(admin_login) as target:
        await provision.ensure_roles()
        stored_passwords = (
            "SELECT string_agg(rolname || rolpassword, ',' ORDER BY rolname) FROM pg_authid "  # noqa: S608
            f"WHERE rolname IN ('{MIGRATOR_DB_USER}', '{APP_DB_USER}')"
        )
        before = await query(target.superuser(), stored_passwords)
        await query(target.superuser(), f'ALTER ROLE "{role}" {attribute if drifted_to else "NO" + attribute}')

        monkeypatch.setenv("MIGRATOR_DB_PASSWORD", "changed-migrator-password")
        monkeypatch.setenv("APP_DB_PASSWORD", "changed-app-password")
        with pytest.raises(RuntimeError) as refusal:
            await provision.ensure_roles()

        restoring_clause = "NO" + attribute if drifted_to else attribute
        assert f'"{role}" {"has" if drifted_to else "lacks"} {attribute}' in str(refusal.value), "the message names the role and attribute"
        assert f'ALTER ROLE "{role}" {restoring_clause}' in str(refusal.value), "the message gives the fix"
        assert await query(target.superuser(), stored_passwords) == before, "neither role's password changed"
        held_now = await query(target.superuser(), f"SELECT {column} FROM pg_roles WHERE rolname = '{role}'")  # noqa: S608
        assert held_now is drifted_to, "the role was not repaired"


async def test_a_failed_password_change_names_the_role_and_never_shows_the_password(provision_into, cluster, monkeypatch):
    """A role the admin cannot administer fails its password change, and the password stays out of the error, the traceback and the log"""
    async with provision_into(RESTRICTED_ADMIN_LOGIN) as target:
        # Created by the superuser, so the admin holds no right over it
        await query(target.superuser(), f'CREATE ROLE "{MIGRATOR_DB_USER}" WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS')
        await query(target.superuser(), f'CREATE ROLE "{APP_DB_USER}" WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS')
        monkeypatch.setenv("MIGRATOR_DB_PASSWORD", _SECRET)
        monkeypatch.setenv("APP_DB_PASSWORD", _SECRET)

        with pytest.raises(DBAPIError) as failure:
            await provision.ensure_roles()

        reported = "".join(traceback.format_exception(failure.value))
        assert MIGRATOR_DB_USER in reported, "the error names the role"
        assert _SECRET not in reported, "the error and its traceback leave the password out"
        server_log = cluster.logs()
        assert f'Could not set the password of the database role "{MIGRATOR_DB_USER}"' in server_log, "the log holds the failure"
        assert _SECRET not in server_log, "the database's own log leaves the password out"


async def test_roles_another_login_created_are_set_up_once_the_admin_is_given_their_administration(provision_into):
    """The recovery the docs give: the admin gets the same administration of each role its creator would get

    Without it the admin may not set the passwords of roles it did not create
    """
    async with provision_into(RESTRICTED_ADMIN_LOGIN) as target:
        # Created by the superuser, so the admin holds no right over them
        for role in (MIGRATOR_DB_USER, APP_DB_USER):
            await query(target.superuser(), f'CREATE ROLE "{role}" WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS')
        with pytest.raises(DBAPIError, match="Could not set the password"):
            await provision.ensure_roles()

        await query(
            target.superuser(),
            f'GRANT "{MIGRATOR_DB_USER}", "{APP_DB_USER}" TO {RESTRICTED_ADMIN_LOGIN} WITH ADMIN OPTION, INHERIT FALSE, SET FALSE',
        )
        await provision.ensure_roles()
        await _build_schema_as(target.engine(RESTRICTED_ADMIN_LOGIN, LOGIN_PASSWORD))
        await provision.transfer_schema_ownership()

        assert await query(target.superuser(), _NOT_OWNED_BY_MIGRATOR.format(migrator=MIGRATOR_DB_USER)) == 0, "the migrator owns the schema"
        assert await query(target.engine(MIGRATOR_DB_USER, MIGRATOR_PASSWORD), "SELECT current_user") == MIGRATOR_DB_USER
        assert await query(target.engine(APP_DB_USER, APP_PASSWORD), "SHOW statement_timeout") == "1min", "the app role got its limits"


async def test_a_password_the_database_refuses_as_text_never_shows_in_the_error(provision_into, tmp_path, monkeypatch):
    """A saved password file edited by hand can hold a NUL, which the database refuses in the statement carrying it

    The statement's bound values stay out of the error and its traceback
    """
    async with provision_into(RESTRICTED_ADMIN_LOGIN):
        monkeypatch.delenv("MIGRATOR_DB_PASSWORD")
        monkeypatch.delenv("APP_DB_PASSWORD")
        monkeypatch.setattr(credentials, "_SECRETS_DIR", tmp_path)
        (tmp_path / "migrator_db_password").write_text(f"{_SECRET}\x00")

        with pytest.raises(DBAPIError, match="invalid byte sequence") as failure:
            await provision.ensure_roles()

        assert _SECRET not in "".join(traceback.format_exception(failure.value)), "the error and its traceback leave the password out"


async def test_set_up_refuses_when_the_admin_cannot_give_the_roles_their_access(provision_into):
    """A grant by a login that owns neither the database nor its schema only warns, so set-up checks the result"""
    async with provision_into(RESTRICTED_ADMIN_LOGIN, owned_by_superuser=True) as target:
        await query(target.superuser(), f'REVOKE CONNECT ON DATABASE "{target.database_name}" FROM PUBLIC')
        await query(target.superuser(), f'GRANT CONNECT ON DATABASE "{target.database_name}" TO {RESTRICTED_ADMIN_LOGIN}')
        await query(target.superuser(), "REVOKE USAGE ON SCHEMA public FROM PUBLIC")
        await query(target.superuser(), f"GRANT USAGE ON SCHEMA public TO {RESTRICTED_ADMIN_LOGIN}")

        with pytest.raises(RuntimeError) as refusal:
            await provision.ensure_roles()

        for missing in (
            f'CREATE on schema public for "{MIGRATOR_DB_USER}"',
            f'USAGE on schema public for "{APP_DB_USER}"',
            f'CONNECT on database "{target.database_name}" for "{APP_DB_USER}"',
        ):
            assert missing in str(refusal.value)
