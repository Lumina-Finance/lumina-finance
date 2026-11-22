"""A throwaway PostgreSQL server for the tests of set-up, and what they share to use it

Set-up creates roles for the whole server and needs an admin login of each kind, so these tests run
it on a server of their own, started through `docker`. Each test gets a database of its own
"""

import asyncio
import os
import secrets
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from cryptography.fernet import Fernet
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

# The settings a set-up job takes a credential or a key from
_CREDENTIAL_SETTINGS = (
    "DB_USER",
    "DB_PASSWORD",
    "MIGRATOR_DB_PASSWORD",
    "APP_DB_PASSWORD",
    "APP_ENCRYPTION_KEY",
    "BANK_TRANSACTION_HASH_KEY",
)


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


def start_server(*options: str, command: tuple[str, ...] = ()) -> Cluster:
    """Start a throwaway server published on loopback and wait until it accepts connections

    Args:
        options: Further `docker run` options, placed before the image
        command: What the container runs in place of the image's own command

    Returns:
        The running server, which the caller removes
    """
    container_id = docker(
        "run", "-d", "--rm", "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432",
        "-e", f"POSTGRES_PASSWORD={LOGIN_PASSWORD}", *options, POSTGRES_IMAGE, *command,
    )  # fmt: skip
    try:
        deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
        # Asked over TCP, so the temporary server the image starts first to set itself up never answers
        while run_docker("exec", container_id, "pg_isready", "-h", "127.0.0.1", "-U", SUPERUSER_LOGIN).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError(f"The throwaway database server did not start in time: {run_docker('logs', container_id).stderr}")
            time.sleep(0.5)
        host, port = docker("port", container_id, "5432/tcp").splitlines()[0].rsplit(":", 1)
    except BaseException:
        run_docker("rm", "-f", "-v", container_id)
        raise
    return Cluster(container_id, host, int(port))


def bootstrap_environment(target: Target, **settings: str) -> dict[str, str]:
    """Return what the bootstrap job is given and nothing more: the admin login and the two role passwords"""
    return target.environment(
        DB_USER=SUPERUSER_LOGIN,
        DB_PASSWORD=LOGIN_PASSWORD,
        MIGRATOR_DB_PASSWORD=MIGRATOR_PASSWORD,
        APP_DB_PASSWORD=APP_PASSWORD,
        **settings,
    )


def migrate_environment(target: Target, **settings: str) -> dict[str, str]:
    """Return what the migrate job is given and nothing more: the migrator's password and the two keys"""
    return target.environment(
        MIGRATOR_DB_PASSWORD=MIGRATOR_PASSWORD,
        APP_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        BANK_TRANSACTION_HASH_KEY=secrets.token_hex(32),
        **settings,
    )


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
        no credential the caller did not hand it. Each credential not given is set empty, since the
        backend fills a setting that is absent from the `.env` file of its folder, where a developer
        keeps the real ones
        """
        return {
            "PATH": os.environ["PATH"],
            **dict.fromkeys(_CREDENTIAL_SETTINGS, ""),
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


async def run_job(job: str, environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Run `python -m app.db.jobs <job>` in a process of its own, as the image does"""
    return await asyncio.to_thread(run_module, "app.db.jobs", job, environment=environment)
