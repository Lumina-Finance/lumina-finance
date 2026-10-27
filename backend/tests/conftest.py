import logging
import os
from collections.abc import AsyncIterator, Callable, Iterator
from datetime import datetime
from types import ModuleType
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import request_hook
from app.abuse_log import abuse_log
from app.config.database import APP_DB_USER, MIGRATOR_DB_USER
from app.config.env import require
from app.database import stamp_request_identity
from app.db.credentials import resolve_role_password
from app.db.rls import apply_rls
from app.models import import_all_models
from app.models.base import Base
from app.request_hook import RequestRecord, observe_requests
from app.services.categories.defaults import seed_system_categories
from app.services.merchants.defaults import seed_system_merchants
from app.valkey_store import ValkeyStore, use_valkey

# Import all models so Base.metadata has the full schema
import_all_models()

# Database credentials come from .env.test, which points at the isolated test database
DB_HOST = require("DB_HOST")
DB_PORT = require("DB_PORT")
DB_NAME = require("DB_NAME")
DB_USER = require("DB_USER")
DB_PASSWORD = require("DB_PASSWORD")

# Under pytest-xdist each worker gets its own database (e.g. lumina_test_gw0) so workers
# don't trample each other's schema/data. When running sequentially the var is unset and
# we fall back to the plain DB_NAME
_xdist_worker = os.environ.get("PYTEST_XDIST_WORKER")
WORKER_DB_NAME = f"{DB_NAME}_{_xdist_worker}" if _xdist_worker else DB_NAME
TEST_DATABASE_URL = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{WORKER_DB_NAME}"

# NullPool avoids connection reuse across tests running on different event loops
engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSession = async_sessionmaker(engine, expire_on_commit=False)

# A second engine connecting as the runtime app role, which unlike the owner above
# is subject to row-level security. Route tests and the isolation tests run their
# code under this role so the policies are actually enforced
_APP_DATABASE_URL = f"postgresql+asyncpg://{APP_DB_USER}:{resolve_role_password('app', generate=False)}@{DB_HOST}:{DB_PORT}/{WORKER_DB_NAME}"
scoped_engine = create_async_engine(_APP_DATABASE_URL, poolclass=NullPool)
ScopedSession = async_sessionmaker(scoped_engine, expire_on_commit=False)

# Stamp the request identity exactly as production does so the policies read it
event.listen(scoped_engine.sync_engine, "begin", stamp_request_identity)

# A third engine connecting as the migrator role, which owns the schema in a deployment once
# ownership is handed to it, for the maintenance commands that run as that role
_MIGRATOR_PASSWORD = resolve_role_password("migrator", generate=False)
_MIGRATOR_DATABASE_URL = f"postgresql+asyncpg://{MIGRATOR_DB_USER}:{_MIGRATOR_PASSWORD}@{DB_HOST}:{DB_PORT}/{WORKER_DB_NAME}"
migrator_engine = create_async_engine(_MIGRATOR_DATABASE_URL, poolclass=NullPool)


@pytest.fixture(scope="session", autouse=True)
async def _setup_schema():
    """Recreate the worker's test DB, then drop and recreate all tables

    Runs once per pytest session (i.e. once per xdist worker). Connects to the
    ``postgres`` maintenance DB with AUTOCOMMIT isolation to drop and recreate
    the worker DB, then recreates the worker's ``public`` schema from metadata.
    Requires the test user to have the ``CREATEDB`` role attribute
    (``ALTER ROLE <user> CREATEDB;``)
    """
    # Sanity-check the worker DB name since it's interpolated into DDL — the
    # identifier can't be passed as a bind parameter. WORKER_DB_NAME is derived
    # from env + xdist's own worker id so this is strictly defensive
    if not all(c.isalnum() or c == "_" for c in WORKER_DB_NAME):
        raise RuntimeError(f"Unsafe worker DB name: {WORKER_DB_NAME!r}")

    maintenance_url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/postgres"
    maintenance_engine = create_async_engine(maintenance_url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    try:
        async with maintenance_engine.connect() as conn:
            # Starting from a new database puts every run on the same path as the
            # first one. Reusing it leaves the previous run's objects for the schema
            # drop below to lock, and across parallel workers that exhausts the
            # cluster's lock table. Connections a dead run left open are closed first, and only
            # client ones: an autovacuum worker may be cleaning the database, it runs as a superuser
            # this role may not terminate, so FORCE would fail on it, while the drop stops it by itself
            await conn.execute(
                text(
                    """
                    SELECT pg_terminate_backend(pid)
                    FROM pg_stat_activity
                    WHERE datname = :database_name
                      AND pid <> pg_backend_pid()
                      AND backend_type = 'client backend'
                    """,
                ),
                {"database_name": WORKER_DB_NAME},
            )
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{WORKER_DB_NAME}"'))
            await conn.execute(text(f'CREATE DATABASE "{WORKER_DB_NAME}"'))
    finally:
        await maintenance_engine.dispose()

    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
        # Apply the same row-level security the migration installs so tests run
        # against the production schema, not a policy-free copy
        await conn.run_sync(apply_rls)

        # Recreating the public schema drops the schema-level grant the provisioner
        # gives the app role, so restore it for tests that connect as that role
        await conn.execute(text(f'GRANT USAGE ON SCHEMA public TO "{APP_DB_USER}"'))


@pytest.fixture(autouse=True)
async def clean_tables():
    """Truncate all tables before each test for a clean slate."""
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE " + ", ".join(t.name for t in reversed(Base.metadata.sorted_tables)) + " CASCADE"))
    async with TestSession() as session:
        await seed_system_categories(session)
        await seed_system_merchants(session)
        await session.commit()
    yield


@pytest.fixture
def freeze_now(monkeypatch) -> Callable[[ModuleType, datetime], None]:
    """Return a function that makes one module's datetime.now answer a fixed moment

    The module must import the datetime class by name, which is what the function replaces
    """

    def freeze(module: ModuleType, moment: datetime) -> None:
        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return moment.astimezone(tz) if tz else moment

        monkeypatch.setattr(module, "datetime", FixedDateTime)

    return freeze


@pytest.fixture
async def valkey_store() -> AsyncIterator[ValkeyStore]:
    """A store over the test ValKey, under a namespace of its own so no test sees another's keys

    Not published to the app, so code under test that finds its store through get_valkey still runs
    without a cache. A missing or unreachable test ValKey fails the tests that ask for it. The test's
    keys are deleted afterwards, since some are stored for months and the test ValKey is shared
    """
    store = ValkeyStore.from_url(require("TEST_VALKEY_URL"), namespace=f"test-{uuid4().hex}:")
    try:
        yield store
    finally:
        try:
            keys = [key async for key in store.client.scan_iter(match=store.namespace + "*")]
            if keys:
                await store.client.delete(*keys)
        finally:
            await store.aclose()


@pytest.fixture
async def published_valkey(valkey_store: ValkeyStore) -> AsyncIterator[ValkeyStore]:
    """The test store, published as the app's cache for the length of the test

    The test client does not run the app's lifespan, which is what publishes the store in production
    """
    async with use_valkey(valkey_store):
        yield valkey_store


@pytest.fixture
def request_records(monkeypatch) -> Iterator[list[RequestRecord]]:
    """The records of the requests answered during the test, as the request observers receive them

    The observers the app registers stay in place, and the one added here is removed afterwards
    """
    monkeypatch.setattr(request_hook, "_observers", list(request_hook._observers))
    records: list[RequestRecord] = []
    observe_requests(records.append)
    yield records


@pytest.fixture
def abuse_log_lines() -> Iterator[list[str]]:
    """The abuse log lines written during the test, as the raw text of each

    Read through a handler of its own because the abuse log writes straight to standard output and
    does not propagate to the root logger, where the log capture fixture listens
    """
    lines: list[str] = []

    class _Collector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(record.getMessage())

    collector = _Collector()
    abuse_log.addHandler(collector)
    try:
        yield lines
    finally:
        abuse_log.removeHandler(collector)
