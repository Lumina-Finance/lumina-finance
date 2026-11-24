"""Database engine and session setup"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config.database import APP_DB_USER, app_database_url, migration_database_url

# Seconds a new connection may take before a request fails, rather than the driver's minute,
# so an unreachable database answers quickly. A reachable one connects in well under a second
CONNECT_TIMEOUT_SECONDS = 10


def create_serving_engine(url: str) -> AsyncEngine:
    """Return the engine requests and the bank sync worker run on

    Each pooled connection is checked before reuse, so one the database or the network dropped
    while it sat in the pool is replaced instead of failing the request that takes it

    Args:
        url: Connection URL of the app role
    """
    return create_async_engine(url, pool_pre_ping=True, connect_args={"timeout": CONNECT_TIMEOUT_SECONDS})


engine = create_serving_engine(app_database_url())

# Holds the authenticated user for the current request so each transaction can
# stamp it onto its connection for the row-level security policies to read
current_user_id_ctx: ContextVar[uuid.UUID | None] = ContextVar("current_user_id", default=None)

# Holds the sign-in session the current request was authenticated under. Cache change
# records name it so that session can tell its own changes apart. It lives here rather than beside
# the authentication dependencies. Those load the token signing keys on import, so code the
# bank sync worker shares with requests needs no keys. Unset outside a request
current_session_id_ctx: ContextVar[uuid.UUID | None] = ContextVar("current_session_id", default=None)

# expire_on_commit=False keeps objects usable after commit without re-fetching
async_session = async_sessionmaker(engine, expire_on_commit=False)

# Written with the asyncpg placeholder style, since exec_driver_sql passes the statement
# to the driver without the translation a SQLAlchemy text() construct would get
_SET_IDENTITY_SQL = "SELECT set_config('app.current_user_id', $1, true)"


def stamp_request_identity(connection) -> None:
    """Stamp the request user onto a new transaction for row-level security

    Raises:
        ValueError: The context variable holds a value that is not a UUID
    """
    # Transaction-local so the value resets on commit and never leaks onto the
    # pooled connection, and re-stamped here whenever a request opens a new one
    user_id = current_user_id_ctx.get()

    # Cast rather than trust the caller, so a value reaching the context variable from a
    # job payload or a database column fails here instead of at policy evaluation. An
    # absent identity stamps empty, which is what makes the policies match no rows
    identity = "" if user_id is None else str(uuid.UUID(str(user_id)))
    connection.exec_driver_sql(_SET_IDENTITY_SQL, (identity,))


# The test suite registers this same listener on its own app-role engine so route
# tests stamp identity exactly as production does
event.listen(engine.sync_engine, "begin", stamp_request_identity)


@contextmanager
def acting_as(user_id: uuid.UUID) -> Iterator[None]:
    """Work as a user, so every session opened inside stamps their identity for row-level security"""
    token = current_user_id_ctx.set(user_id)
    try:
        yield
    finally:
        current_user_id_ctx.reset(token)


async def get_db():
    """Yield an async database session for use as a FastAPI dependency

    Yields:
        An AsyncSession that is automatically closed when the request completes
    """
    # Clear any inherited identity so a request can only ever stamp its own user,
    # independent of how the server reuses execution contexts between requests
    current_user_id_ctx.set(None)
    async with async_session() as session:
        yield session


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the session factory for work a route leaves to run after its response

    A FastAPI dependency, so tests can point that work at their own database the way they replace
    get_db

    Returns:
        The factory get_db opens its sessions from
    """
    return async_session


async def verify_app_role_is_unprivileged() -> None:
    """Fail startup unless requests run as the unprivileged app role

    Row-level security only constrains the app role, so serving requests as a
    superuser, a BYPASSRLS role or a member of the role owning the tables would
    silently disable tenant isolation. A REPLICATION role can stream every row over a
    replication connection with the same password. Startup refuses any membership,
    since the app role needs none. This checks the live connection rather than trusting
    configuration

    Raises:
        RuntimeError: The runtime connection or its password can bypass row-level security
    """
    async with engine.connect() as connection:
        role_name, is_superuser, bypasses_rls, replicates, member_of = (
            await connection.execute(
                text(
                    "SELECT current_user, "
                    "current_setting('is_superuser') = 'on', "
                    "(SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), "
                    "(SELECT rolreplication FROM pg_roles WHERE rolname = current_user), "
                    "ARRAY(SELECT DISTINCT r.rolname::text FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid "
                    "WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) ORDER BY 1)"
                )
            )
        ).one()

    if role_name != APP_DB_USER or is_superuser or bypasses_rls or replicates or member_of:
        raise RuntimeError(
            f"Refusing to start: requests must use the unprivileged role {APP_DB_USER!r}, but the "
            f"connection is role={role_name!r} superuser={is_superuser} bypassrls={bypasses_rls} "
            f"replication={replicates} member_of={member_of}"
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
