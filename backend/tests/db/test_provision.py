"""Role provisioning tests against a real PostgreSQL server

The admin login that runs set-up may or may not be a superuser, so these tests run it on a server of
their own, started for the module with a login of each kind. The server is removed afterwards, each
test gets a database of its own. The managed roles belong to the whole server, so each test drops them
when it ends
"""

import os
import subprocess
import sys
import time
import traceback
import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app import database
from app.config import database as database_config
from app.config.database import APP_DB_USER, MIGRATOR_DB_USER
from app.db import provision
from app.db.rls import apply_rls
from app.models.base import Base

# The server image the app's own deployment and CI use
_POSTGRES_IMAGE = "postgres:17"

# Seconds the throwaway server gets to accept connections on its published port
_STARTUP_TIMEOUT_SECONDS = 60

# Passwords holding characters a connection URL or a statement could mistake for syntax
_MIGRATOR_PASSWORD = "it's 50%41off :1"
_APP_PASSWORD = "ab/:cd@e#f"
_NEW_APP_PASSWORD = "a-new:password"

# A password no error message or log line may ever hold
_SECRET = "Zq9-never-in-a-log"

_SUPERUSER_LOGIN = "postgres"
_RESTRICTED_ADMIN_LOGIN = "restricted_admin"
_LOGIN_PASSWORD = "admin-password"

# Seconds the restricted admin waits for a table lock before the database cancels its statement, so a
# run that touches a locked table fails here instead of hanging
_ADMIN_LOCK_TIMEOUT_SECONDS = 3

_BACKEND_DIR = Path(__file__).resolve().parents[2]

_ADMIN_LOGINS = pytest.mark.parametrize("admin_login", [_SUPERUSER_LOGIN, _RESTRICTED_ADMIN_LOGIN], ids=["superuser", "without-superuser"])


@dataclass(frozen=True)
class Cluster:
    """A running throwaway server and how to reach it"""

    container_id: str
    host: str
    port: int

    def engine(self, login: str, password: str, database_name: str = "postgres", *, autocommit: bool = True) -> AsyncEngine:
        """Return an engine on one of the server's databases, opening a connection per use"""
        url = URL.create("postgresql+asyncpg", login, password, self.host, self.port, database_name)
        options = {"isolation_level": "AUTOCOMMIT"} if autocommit else {}
        return create_async_engine(url, poolclass=NullPool, **options)

    def logs(self) -> str:
        """Return everything the server has logged"""
        result = _run_docker("logs", self.container_id)
        return result.stdout + result.stderr


def _run_docker(*arguments: str, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    """Run a Docker command and return how it ended"""
    # Every argument is fixed in this file or made by it, and the Docker client is found on the path
    return subprocess.run(("docker", *arguments), input=input_text, capture_output=True, text=True, check=False)  # noqa: S603, S607


def _docker(*arguments: str, input_text: str | None = None) -> str:
    """Run a Docker command and return its output, failing with the command's own error"""
    result = _run_docker(*arguments, input_text=input_text)
    if result.returncode != 0:
        raise RuntimeError(f"docker {arguments[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


@pytest.fixture(scope="module")
def cluster() -> Iterator[Cluster]:
    """Start a server holding a superuser and a login that can only create roles and databases"""
    container_id = _docker(
        "run", "-d", "--rm", "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432",
        "-e", f"POSTGRES_PASSWORD={_LOGIN_PASSWORD}", _POSTGRES_IMAGE,
    )  # fmt: skip
    try:
        deadline = time.monotonic() + _STARTUP_TIMEOUT_SECONDS
        # Asked over TCP, so the temporary server the image starts first to set itself up never answers
        while _run_docker("exec", container_id, "pg_isready", "-h", "127.0.0.1", "-U", _SUPERUSER_LOGIN).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError("The throwaway database server did not start in time")
            time.sleep(0.5)
        host, port = _docker("port", container_id, "5432/tcp").splitlines()[0].rsplit(":", 1)
        _docker(
            "exec", "-i", container_id, "psql", "-U", _SUPERUSER_LOGIN, "-v", "ON_ERROR_STOP=1",
            input_text=(
                f"CREATE ROLE {_RESTRICTED_ADMIN_LOGIN} LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD '{_LOGIN_PASSWORD}';"
                f"ALTER ROLE {_RESTRICTED_ADMIN_LOGIN} SET lock_timeout = '{_ADMIN_LOCK_TIMEOUT_SECONDS}s'"
            ),
        )  # fmt: skip
        yield Cluster(container_id, host, int(port))
    finally:
        _run_docker("rm", "-f", "-v", container_id)


@dataclass(frozen=True)
class Target:
    """The database set-up is pointed at"""

    cluster: Cluster
    database_name: str

    def engine(self, login: str, password: str, *, autocommit: bool = True) -> AsyncEngine:
        """Return an engine on the database for one of its logins"""
        return self.cluster.engine(login, password, self.database_name, autocommit=autocommit)

    def superuser(self) -> AsyncEngine:
        """Return an engine on the database for the server's superuser"""
        return self.engine(_SUPERUSER_LOGIN, _LOGIN_PASSWORD)


@pytest.fixture
def provision_into(cluster: Cluster, monkeypatch) -> Callable:
    """Return a context manager that makes set-up run as a login against a new database

    The login creates the database itself, as a login without superuser rights has to, unless the
    superuser is to own it. The database and the managed roles are dropped when the block ends
    """

    @asynccontextmanager
    async def point_at(login: str, *, owned_by_superuser: bool = False) -> AsyncIterator[Target]:
        """Create the database and aim set-up at it for the login"""
        target = Target(cluster, f"provision_{uuid.uuid4().hex[:12]}")
        creator = cluster.engine(_SUPERUSER_LOGIN if owned_by_superuser else login, _LOGIN_PASSWORD)
        async with creator.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{target.database_name}"'))
        await creator.dispose()

        monkeypatch.setattr(database_config, "DB_HOST", cluster.host)
        monkeypatch.setattr(database_config, "DB_PORT", str(cluster.port))
        monkeypatch.setattr(database_config, "DB_NAME", target.database_name)
        monkeypatch.setattr(provision, "DB_NAME", target.database_name)
        monkeypatch.setenv("DB_USER", login)
        monkeypatch.setenv("DB_PASSWORD", _LOGIN_PASSWORD)
        monkeypatch.setenv("MIGRATOR_DB_PASSWORD", _MIGRATOR_PASSWORD)
        monkeypatch.setenv("APP_DB_PASSWORD", _APP_PASSWORD)
        try:
            yield target
        finally:
            superuser = cluster.engine(_SUPERUSER_LOGIN, _LOGIN_PASSWORD)
            async with superuser.connect() as connection:
                await connection.execute(text(f'DROP DATABASE IF EXISTS "{target.database_name}" WITH (FORCE)'))
                await connection.execute(text(f'DROP ROLE IF EXISTS "{MIGRATOR_DB_USER}", "{APP_DB_USER}"'))
            await superuser.dispose()

    return point_at


async def _query(engine: AsyncEngine, statement: str):
    """Run one statement on an engine and return its first value, closing the engine afterwards"""
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text(statement))
            return result.scalar() if result.returns_rows else None
    finally:
        await engine.dispose()


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
    environment = os.environ.copy()
    environment.update(
        {
            "DB_HOST": target.cluster.host,
            "DB_PORT": str(target.cluster.port),
            "DB_NAME": target.database_name,
            "MIGRATOR_DB_PASSWORD": _MIGRATOR_PASSWORD,
            "APP_DB_PASSWORD": _APP_PASSWORD,
        }
    )
    # The arguments are fixed, and a process keeps the migrations' imports out of the test run
    completed = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
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
        assert await _query(app_engine, "SHOW statement_timeout") == "1min", "the app role's statement limit applies"
        assert await _query(app_engine, "SHOW idle_in_transaction_session_timeout") == "5min", "the app role's idle limit applies"
        assert await _query(app_engine, "SELECT count(*) FROM users") == 0, "the app role reads the tables it was granted"
        migrator_engine = target.engine(MIGRATOR_DB_USER, _MIGRATOR_PASSWORD)
        assert await _query(migrator_engine, "SELECT current_user") == MIGRATOR_DB_USER, "the migrator signs in with its password"


async def test_a_restored_dump_is_handed_to_the_migrator_by_an_admin_without_superuser_rights(provision_into):
    """After a restore every object is owned by the restoring admin, and each moves to the migrator"""
    async with provision_into(_RESTRICTED_ADMIN_LOGIN) as target:
        await provision.ensure_roles()
        await _build_schema_as(target.engine(_RESTRICTED_ADMIN_LOGIN, _LOGIN_PASSWORD))
        assert await _query(target.superuser(), _NOT_OWNED_BY_MIGRATOR.format(migrator=MIGRATOR_DB_USER)) > 0, "the dump starts admin-owned"

        await provision.transfer_schema_ownership()
        await provision.apply_row_level_security()

        assert await _query(target.superuser(), _NOT_OWNED_BY_MIGRATOR.format(migrator=MIGRATOR_DB_USER)) == 0, (
            "every table, sequence, function and enum type now belongs to the migrator"
        )
        app_engine = target.engine(APP_DB_USER, _APP_PASSWORD)
        assert await _query(app_engine, "SELECT count(*) FROM users") == 0, "the policies and grants were rebuilt for the app role"


async def test_a_run_with_nothing_to_move_waits_for_no_table_lock(provision_into):
    """Changing an owner locks its table even when the owner stays the same, so set-up must leave owned tables alone

    The migrator holds the heaviest lock on a table, as a running migration would, and the admin cancels
    any statement that waits for a lock, so a run that reached the table fails
    """
    async with provision_into(_RESTRICTED_ADMIN_LOGIN) as target:
        await provision.ensure_roles()
        await _build_schema_as(target.engine(_RESTRICTED_ADMIN_LOGIN, _LOGIN_PASSWORD))
        await provision.transfer_schema_ownership()

        holder = target.engine(MIGRATOR_DB_USER, _MIGRATOR_PASSWORD, autocommit=False)
        async with holder.connect() as connection, connection.begin():
            await connection.execute(text("LOCK TABLE users IN ACCESS EXCLUSIVE MODE"))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await _query(target.engine(_RESTRICTED_ADMIN_LOGIN, _LOGIN_PASSWORD), f'ALTER TABLE users OWNER TO "{MIGRATOR_DB_USER}"')
            await provision.ensure_roles()
            await provision.transfer_schema_ownership()
        await holder.dispose()


@pytest.mark.parametrize(
    ("admin_login", "role", "column", "attribute", "drifted_to"),
    [
        (_RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolsuper", "SUPERUSER", True),
        (_RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolbypassrls", "BYPASSRLS", True),
        (_RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolcreaterole", "CREATEROLE", True),
        (_RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolcreatedb", "CREATEDB", True),
        (_RESTRICTED_ADMIN_LOGIN, APP_DB_USER, "rolcanlogin", "LOGIN", False),
        (_RESTRICTED_ADMIN_LOGIN, MIGRATOR_DB_USER, "rolbypassrls", "BYPASSRLS", True),
        (_SUPERUSER_LOGIN, APP_DB_USER, "rolbypassrls", "BYPASSRLS", True),
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
        before = await _query(target.superuser(), stored_passwords)
        await _query(target.superuser(), f'ALTER ROLE "{role}" {attribute if drifted_to else "NO" + attribute}')

        monkeypatch.setenv("MIGRATOR_DB_PASSWORD", "changed-migrator-password")
        monkeypatch.setenv("APP_DB_PASSWORD", "changed-app-password")
        with pytest.raises(RuntimeError) as refusal:
            await provision.ensure_roles()

        restoring_clause = "NO" + attribute if drifted_to else attribute
        assert f'"{role}" {"has" if drifted_to else "lacks"} {attribute}' in str(refusal.value), "the message names the role and attribute"
        assert f'ALTER ROLE "{role}" {restoring_clause}' in str(refusal.value), "the message gives the fix"
        assert await _query(target.superuser(), stored_passwords) == before, "neither role's password changed"
        held_now = await _query(target.superuser(), f"SELECT {column} FROM pg_roles WHERE rolname = '{role}'")  # noqa: S608
        assert held_now is drifted_to, "the role was not repaired"


async def test_a_failed_password_change_names_the_role_and_never_shows_the_password(provision_into, cluster, monkeypatch):
    """A role the admin cannot administer fails its password change, and the password stays out of the error, the traceback and the log"""
    async with provision_into(_RESTRICTED_ADMIN_LOGIN) as target:
        # Created by the superuser, so the admin holds no right over it
        await _query(target.superuser(), f'CREATE ROLE "{MIGRATOR_DB_USER}" WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS')
        await _query(target.superuser(), f'CREATE ROLE "{APP_DB_USER}" WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS')
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


async def test_set_up_refuses_when_the_admin_cannot_give_the_roles_their_access(provision_into):
    """A grant by a login that owns neither the database nor its schema only warns, so set-up checks the result"""
    async with provision_into(_RESTRICTED_ADMIN_LOGIN, owned_by_superuser=True) as target:
        await _query(target.superuser(), f'REVOKE CONNECT ON DATABASE "{target.database_name}" FROM PUBLIC')
        await _query(target.superuser(), f'GRANT CONNECT ON DATABASE "{target.database_name}" TO {_RESTRICTED_ADMIN_LOGIN}')
        await _query(target.superuser(), "REVOKE USAGE ON SCHEMA public FROM PUBLIC")
        await _query(target.superuser(), f"GRANT USAGE ON SCHEMA public TO {_RESTRICTED_ADMIN_LOGIN}")

        with pytest.raises(RuntimeError) as refusal:
            await provision.ensure_roles()

        for missing in (
            f'CREATE on schema public for "{MIGRATOR_DB_USER}"',
            f'USAGE on schema public for "{APP_DB_USER}"',
            f'CONNECT on database "{target.database_name}" for "{APP_DB_USER}"',
        ):
            assert missing in str(refusal.value)
