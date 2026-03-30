import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import _require
from app.models.base import Base

# Test database credentials — separate user/db from development
TEST_DB_HOST = _require("TEST_DB_HOST")
TEST_DB_PORT = _require("TEST_DB_PORT")
TEST_DB_NAME = _require("TEST_DB_NAME")
TEST_DB_USER = _require("TEST_DB_USER")
TEST_DB_PASSWORD = _require("TEST_DB_PASSWORD")
TEST_DATABASE_URL = f"postgresql+asyncpg://{TEST_DB_USER}:{TEST_DB_PASSWORD}@{TEST_DB_HOST}:{TEST_DB_PORT}/{TEST_DB_NAME}"

# NullPool avoids connection reuse across tests running on different event loops
engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSession = async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def clean_tables():
    """Truncate all tables before each test for a clean slate."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "TRUNCATE " + ", ".join(t.name for t in reversed(Base.metadata.sorted_tables)) + " CASCADE"
        ))
    yield


@pytest.fixture
async def db():
    """Provide a database session for each test."""
    async with TestSession() as session:
        yield session
