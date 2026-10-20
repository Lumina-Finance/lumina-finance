"""Database connection settings and per-role connection URLs"""

from urllib.parse import quote

from app.config.env import require
from app.db.credentials import resolve_role_password

# Every role connects to the same database, so host, port, and name are shared
DB_HOST = require("DB_HOST")
DB_PORT = require("DB_PORT")
DB_NAME = require("DB_NAME")

# SQLAlchemy driver used for every async PostgreSQL connection
_DB_URL_SCHEME = "postgresql+asyncpg"

# The migrator role owns the tables and runs migrations and seeding. The app role
# serves normal requests and is the one restricted by row-level security. Both
# names are fixed and are never configurable by the operator
MIGRATOR_DB_USER = "lumina_migrator"
APP_DB_USER = "lumina_app"


def _build_database_url(user: str, password: str) -> str:
    """Return the asyncpg connection URL for a role against the shared database

    Args:
        user: Database role name
        password: Password for the role, in any form the database accepts

    Returns:
        An asyncpg SQLAlchemy connection URL with the credentials percent-encoded

    Raises:
        ValueError: The role name or password cannot be encoded, naming the one to fix without echoing it
    """
    # Every reserved character is percent-encoded, since a password may hold any of them
    # The default encoding error names the offending character, so each failure names only the
    # credential to fix and never any of its value
    try:
        encoded_user = quote(user, safe="")
    except UnicodeEncodeError:
        raise ValueError("A database role name cannot be encoded as UTF-8") from None
    try:
        encoded_password = quote(password, safe="")
    except UnicodeEncodeError:
        raise ValueError(f"The password for the {user} database role cannot be encoded as UTF-8") from None
    return f"{_DB_URL_SCHEME}://{encoded_user}:{encoded_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


# Each URL resolves its password lazily so a process only needs its own role's secret
def migration_database_url() -> str:
    """Return the connection URL for the migrator role"""
    return _build_database_url(MIGRATOR_DB_USER, resolve_role_password("migrator", generate=False))


def app_database_url() -> str:
    """Return the connection URL for the app role"""
    return _build_database_url(APP_DB_USER, resolve_role_password("app", generate=False))


def admin_database_url() -> str:
    """Return the connection URL for the admin role"""
    return _build_database_url(require("DB_USER"), require("DB_PASSWORD"))
