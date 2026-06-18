"""Database engine and session setup"""

import uuid
from contextvars import ContextVar

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import app_database_url, migration_database_url

engine = create_async_engine(app_database_url())

# Holds the authenticated user for the current request so each transaction can
# stamp it onto its connection for the row-level security policies to read
current_user_id_ctx: ContextVar[uuid.UUID | None] = ContextVar("current_user_id", default=None)

# expire_on_commit=False keeps objects usable after commit without re-fetching
async_session = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "begin")
def _stamp_request_user(connection) -> None:
    """Stamp the request user onto each new transaction for row-level security"""
    # Transaction-local so the value resets on commit and never leaks onto the
    # pooled connection, and re-stamped here whenever a request opens a new one
    user_id = current_user_id_ctx.get()

    # The value is always a validated UUID or empty, so it is safe to inline, and a
    # bound parameter is not available inside this connection-begin event
    identity = str(user_id) if user_id is not None else ""
    connection.exec_driver_sql(f"SELECT set_config('app.current_user_id', '{identity}', true)")


async def get_db():
    """Yield an async database session for use as a FastAPI dependency.

    Yields:
        An AsyncSession that is automatically closed when the request completes.
    """
    # Clear any inherited identity so a request can only ever stamp its own user,
    # independent of how the server reuses execution contexts between requests
    current_user_id_ctx.set(None)
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
