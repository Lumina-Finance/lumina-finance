"""Database engine and session setup"""

import uuid
from contextvars import ContextVar

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import APP_DB_USER, app_database_url, migration_database_url

engine = create_async_engine(app_database_url())

# Holds the authenticated user for the current request so each transaction can
# stamp it onto its connection for the row-level security policies to read
current_user_id_ctx: ContextVar[uuid.UUID | None] = ContextVar("current_user_id", default=None)

# expire_on_commit=False keeps objects usable after commit without re-fetching
async_session = async_sessionmaker(engine, expire_on_commit=False)


def stamp_request_identity(connection) -> None:
    """Stamp the request user onto a new transaction for row-level security"""
    # Transaction-local so the value resets on commit and never leaks onto the
    # pooled connection, and re-stamped here whenever a request opens a new one
    user_id = current_user_id_ctx.get()

    # The value is always a validated UUID or empty, so it is safe to inline, and a
    # bound parameter is not available inside this connection-begin event
    identity = str(user_id) if user_id is not None else ""
    connection.exec_driver_sql(f"SELECT set_config('app.current_user_id', '{identity}', true)")


# The test suite registers this same listener on its own app-role engine so route
# tests stamp identity exactly as production does
event.listen(engine.sync_engine, "begin", stamp_request_identity)


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


async def verify_app_role_is_unprivileged() -> None:
    """Fail startup unless requests run as the unprivileged app role

    Row-level security only constrains the app role, so serving requests as a
    superuser, a BYPASSRLS role, or the table owner would silently disable tenant
    isolation. This checks the live connection rather than trusting configuration

    Raises:
        RuntimeError: The runtime connection can bypass row-level security
    """
    async with engine.connect() as connection:
        role_name, is_superuser, bypasses_rls = (
            await connection.execute(text(
                "SELECT current_user, "
                "current_setting('is_superuser') = 'on', "
                "(SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)"
            ))
        ).one()

    if role_name != APP_DB_USER or is_superuser or bypasses_rls:
        raise RuntimeError(
            f"Refusing to start: requests must use the unprivileged role {APP_DB_USER!r}, but the "
            f"connection is role={role_name!r} superuser={is_superuser} bypassrls={bypasses_rls}"
        )


def create_migration_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return a session factory bound to the migrator role for privileged seeding

    The migrator engine is built on demand rather than at import so a request
    serving process never opens a connection with the migrator role

    Returns:
        An async session factory connected as the migrator role
    """
    migration_engine = create_async_engine(migration_database_url())
    return async_sessionmaker(migration_engine, expire_on_commit=False)
