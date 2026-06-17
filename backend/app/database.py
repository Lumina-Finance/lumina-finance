"""Database engine and session setup"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import app_database_url, migration_database_url

engine = create_async_engine(app_database_url())

# expire_on_commit=False keeps objects usable after commit without re-fetching
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    """Yield an async database session for use as a FastAPI dependency.

    Yields:
        An AsyncSession that is automatically closed when the request completes.
    """
    async with async_session() as session:
        yield session


def create_migration_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return a session factory bound to the migrator role for privileged seeding

    The migrator engine is built on demand rather than at import so a request
    serving process never opens a connection with the migrator role

    Returns:
        An async session factory connected as the migrator role
    """
    migration_engine = create_async_engine(migration_database_url())
    return async_sessionmaker(migration_engine, expire_on_commit=False)
