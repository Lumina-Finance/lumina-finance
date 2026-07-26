"""Database connection settings and per-role connection URLs"""

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
        password: Password for the role

    Returns:
        An asyncpg SQLAlchemy connection URL
    """
    return f"{_DB_URL_SCHEME}://{user}:{password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


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
