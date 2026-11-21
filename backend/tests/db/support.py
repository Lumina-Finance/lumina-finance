"""A throwaway PostgreSQL server for the tests of set-up, and what they share to use it

Set-up creates roles for the whole server and needs an admin login of each kind, so these tests run
it on a server of their own, started through `docker`. Each test gets a database of its own
"""

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

# The server image the app's own deployment and CI use
POSTGRES_IMAGE = "postgres:17"

# Seconds the throwaway server gets to accept connections on its published port
STARTUP_TIMEOUT_SECONDS = 60

# Passwords holding characters a connection URL or a statement could mistake for syntax
MIGRATOR_PASSWORD = "it's 50%41off :1"
APP_PASSWORD = "ab/:cd@e#f"

SUPERUSER_LOGIN = "postgres"
RESTRICTED_ADMIN_LOGIN = "restricted_admin"
LOGIN_PASSWORD = "admin-password"

# Seconds the restricted admin waits for a table lock before the database cancels its statement, so a
# run that touches a locked table fails here instead of hanging
ADMIN_LOCK_TIMEOUT_SECONDS = 3

BACKEND_DIR = Path(__file__).resolve().parents[2]


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
        result = run_docker("logs", self.container_id)
        return result.stdout + result.stderr


def run_docker(*arguments: str, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    """Run a Docker command and return how it ended"""
    # Every argument is fixed in this file or made by it, and the Docker client is found on the path
    return subprocess.run(("docker", *arguments), input=input_text, capture_output=True, text=True, check=False)  # noqa: S603, S607


def docker(*arguments: str, input_text: str | None = None) -> str:
    """Run a Docker command and return its output, failing with the command's own error"""
    result = run_docker(*arguments, input_text=input_text)
    if result.returncode != 0:
        raise RuntimeError(f"docker {arguments[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


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
        return self.engine(SUPERUSER_LOGIN, LOGIN_PASSWORD)

    def environment(self, **settings: str) -> dict[str, str]:
        """Return the environment of a process that reaches this database, holding only what is given

        Nothing of the test run's own environment is carried over, so a process started with it holds
        no credential the caller did not hand it
        """
        return {
            "PATH": os.environ["PATH"],
            "DB_HOST": self.cluster.host,
            "DB_PORT": str(self.cluster.port),
            "DB_NAME": self.database_name,
            **settings,
        }


async def query(engine: AsyncEngine, statement: str):
    """Run one statement on an engine and return its first value, closing the engine afterwards"""
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text(statement))
            return result.scalar() if result.returns_rows else None
    finally:
        await engine.dispose()


def run_module(module: str, *arguments: str, environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Run a backend module in a process of its own with exactly the environment given

    A process keeps the imports of what it runs out of the test run, and holds only the settings it is given
    """
    # The arguments are fixed by the tests, and the interpreter is the one running them
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", module, *arguments], cwd=BACKEND_DIR, env=environment, check=False, capture_output=True, text=True
    )
