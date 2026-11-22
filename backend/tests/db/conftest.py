"""Fixtures for the tests that run set-up against a server of their own"""

import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text

from app.config import database as database_config
from app.config.database import APP_DB_USER, MIGRATOR_DB_USER
from app.db import provision
from tests.db.support import (
    ADMIN_LOCK_TIMEOUT_SECONDS,
    APP_PASSWORD,
    LOGIN_PASSWORD,
    MIGRATOR_PASSWORD,
    RESTRICTED_ADMIN_LOGIN,
    SUPERUSER_LOGIN,
    Cluster,
    Target,
    docker,
    run_docker,
    start_server,
)


@pytest.fixture(scope="module")
def cluster() -> Iterator[Cluster]:
    """Start a server holding a superuser and a login that can only create roles and databases

    The server is removed afterwards. The managed roles belong to the whole server, so each test
    drops them when it ends
    """
    server = start_server()
    try:
        docker(
            "exec", "-i", server.container_id, "psql", "-U", SUPERUSER_LOGIN, "-v", "ON_ERROR_STOP=1",
            input_text=(
                f"CREATE ROLE {RESTRICTED_ADMIN_LOGIN} LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD '{LOGIN_PASSWORD}';"
                f"ALTER ROLE {RESTRICTED_ADMIN_LOGIN} SET lock_timeout = '{ADMIN_LOCK_TIMEOUT_SECONDS}s'"
            ),
        )  # fmt: skip
        yield server
    finally:
        run_docker("rm", "-f", "-v", server.container_id)


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
        creator = cluster.engine(SUPERUSER_LOGIN if owned_by_superuser else login, LOGIN_PASSWORD)
        async with creator.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{target.database_name}"'))
        await creator.dispose()

        monkeypatch.setattr(database_config, "DB_HOST", cluster.host)
        monkeypatch.setattr(database_config, "DB_PORT", str(cluster.port))
        monkeypatch.setattr(database_config, "DB_NAME", target.database_name)
        monkeypatch.setattr(provision, "DB_NAME", target.database_name)
        monkeypatch.setenv("DB_USER", login)
        monkeypatch.setenv("DB_PASSWORD", LOGIN_PASSWORD)
        monkeypatch.setenv("MIGRATOR_DB_PASSWORD", MIGRATOR_PASSWORD)
        monkeypatch.setenv("APP_DB_PASSWORD", APP_PASSWORD)
        try:
            yield target
        finally:
            superuser = cluster.engine(SUPERUSER_LOGIN, LOGIN_PASSWORD)
            async with superuser.connect() as connection:
                await connection.execute(text(f'DROP DATABASE IF EXISTS "{target.database_name}" WITH (FORCE)'))
                await connection.execute(text(f'DROP ROLE IF EXISTS "{MIGRATOR_DB_USER}", "{APP_DB_USER}"'))
            await superuser.dispose()

    return point_at
