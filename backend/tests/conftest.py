import os

os.environ["TESTING"] = "1"  # Must be set before app imports to use lightweight argon2 params

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import _require

# Import all models so Base.metadata has the full schema
from app.models import (  # noqa: F401
    account,
    active_token,
    auth,
    budget,
    category,
    currency,
    group,
    institution,
    merchant,
    tag,
    transaction,
    user,
)
from app.models.base import Base

# Test database credentials — separate user/db from development
TEST_DB_HOST = _require("TEST_DB_HOST")
TEST_DB_PORT = _require("TEST_DB_PORT")
TEST_DB_NAME = _require("TEST_DB_NAME")
TEST_DB_USER = _require("TEST_DB_USER")
TEST_DB_PASSWORD = _require("TEST_DB_PASSWORD")

# Under pytest-xdist each worker gets its own database (e.g. lumina_test_gw0) so workers
# don't trample each other's schema/data. When running sequentially the var is unset and
# we fall back to the plain TEST_DB_NAME.
_xdist_worker = os.environ.get("PYTEST_XDIST_WORKER")
WORKER_DB_NAME = f"{TEST_DB_NAME}_{_xdist_worker}" if _xdist_worker else TEST_DB_NAME
TEST_DATABASE_URL = f"postgresql+asyncpg://{TEST_DB_USER}:{TEST_DB_PASSWORD}@{TEST_DB_HOST}:{TEST_DB_PORT}/{WORKER_DB_NAME}"

# NullPool avoids connection reuse across tests running on different event loops
engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSession = async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture(scope="session", autouse=True)
async def _setup_schema():
    """Ensure the worker's test DB exists, then drop and recreate all tables.

    Runs once per pytest session (i.e. once per xdist worker). Connects to the
    ``postgres`` maintenance DB with AUTOCOMMIT isolation to issue
    ``CREATE DATABASE`` if the worker DB doesn't already exist, then uses the
    worker engine to reset the schema. Requires the test user to have the
    ``CREATEDB`` role attribute (``ALTER ROLE <user> CREATEDB;``).
    """
    # Sanity-check the worker DB name since it's interpolated into DDL — the
    # identifier can't be passed as a bind parameter. WORKER_DB_NAME is derived
    # from env + xdist's own worker id so this is strictly defensive.
    if not all(c.isalnum() or c == "_" for c in WORKER_DB_NAME):
        raise RuntimeError(f"Unsafe worker DB name: {WORKER_DB_NAME!r}")

    maintenance_url = f"postgresql+asyncpg://{TEST_DB_USER}:{TEST_DB_PASSWORD}@{TEST_DB_HOST}:{TEST_DB_PORT}/postgres"
    maintenance_engine = create_async_engine(maintenance_url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    try:
        async with maintenance_engine.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": WORKER_DB_NAME},
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{WORKER_DB_NAME}"'))
    finally:
        await maintenance_engine.dispose()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture(autouse=True)
async def clean_tables():
    """Truncate all tables before each test for a clean slate."""
    async with engine.begin() as conn:
        await conn.execute(text(
            "TRUNCATE " + ", ".join(t.name for t in reversed(Base.metadata.sorted_tables)) + " CASCADE"
        ))
    yield
