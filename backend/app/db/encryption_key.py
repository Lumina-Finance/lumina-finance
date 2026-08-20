"""Provision the encryption key and bind it to the data it protects"""

import asyncio
import os
import sys

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app import encryption
from app.config.database import admin_database_url, migration_database_url
from app.models import import_all_models
from app.models.base import Base
from app.models.encryption_key import SINGLETON_ID
from app.models.types import find_encrypted_columns

_FINGERPRINT_TABLE = "encryption_key_fingerprint"

# Present once the schema has been built, so its absence is what distinguishes a first
# install from a deployment whose key file was removed
_MIGRATION_TABLE = "alembic_version"


async def _table_exists(connection: AsyncConnection, table: str) -> bool:
    """Whether a public table is present in the database"""
    qualified = await connection.scalar(text("SELECT to_regclass(:qualified)"), {"qualified": f"public.{table}"})
    return qualified is not None


async def read_fingerprint(connection: AsyncConnection) -> str | None:
    """Return the recorded key fingerprint, or None when nothing is recorded yet

    Args:
        connection: Open connection to the application database

    Returns:
        The recorded SHA-256 hex digest, or None when the table or the row is absent
    """
    if not await _table_exists(connection, _FINGERPRINT_TABLE):
        return None

    # Read the single row stating which key this database's secrets are under
    return await connection.scalar(
        text(f"SELECT fingerprint FROM public.{_FINGERPRINT_TABLE} WHERE id = :id"),
        {"id": SINGLETON_ID},
    )


async def record_fingerprint(connection: AsyncConnection, key: str) -> None:
    """Record the key the stored secrets are under, replacing any earlier record

    Args:
        connection: Open connection inside the transaction that wrote the secrets
        key: The url-safe base64 Fernet key the data is now encrypted under
    """
    # Upsert the single row, so recording after a rotation replaces the previous key
    await connection.execute(
        text(
            f"INSERT INTO public.{_FINGERPRINT_TABLE} (id, fingerprint) VALUES (:id, :fingerprint) "
            f"ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, updated_at = now()"
        ),
        {"id": SINGLETON_ID, "fingerprint": encryption.key_fingerprint(key)},
    )


async def read_stored_secret(connection: AsyncConnection) -> str | None:
    """Return one stored Fernet token, or None when nothing is encrypted yet

    Args:
        connection: Open connection to the application database

    Returns:
        A single stored token from any encrypted column, or None when every one is empty
    """
    import_all_models()
    for table, column in find_encrypted_columns(Base.metadata):
        if not await _table_exists(connection, table):
            continue

        # Table and column come from the model metadata rather than any caller, so they are
        # safe to interpolate, as the row-level security statements do with the same values
        value = await connection.scalar(
            text(f"SELECT {column} FROM public.{table} WHERE {column} IS NOT NULL LIMIT 1")
        )
        if value is not None:
            return value
    return None


def decrypts(key: str, token: str) -> bool:
    """Whether a key reads a stored token

    Args:
        key: The url-safe base64 Fernet key to try
        token: A Fernet token read from storage

    Returns:
        Whether the key decrypts the token
    """
    try:
        Fernet(key.encode()).decrypt(token.encode())
    except (InvalidToken, ValueError):
        return False
    return True


async def verify_key_matches_data(connection: AsyncConnection) -> None:
    """Raise when the resolved key is not the one this database's secrets are under

    A recorded fingerprint that disagrees with the resolved key means every stored secret
    is unreadable, and serving anyway would write new secrets under the wrong key and mix
    two keys inside one column. Nothing is recorded before the first verify-fingerprint
    run, and that state is not an error

    Args:
        connection: Open connection to the application database

    Raises:
        RuntimeError: The recorded fingerprint and the resolved key disagree
    """
    recorded = await read_fingerprint(connection)
    if recorded is None:
        return

    key = encryption.resolve_encryption_key(generate=False)
    if recorded != encryption.key_fingerprint(key):
        raise RuntimeError(
            "Refusing to start: the stored secrets were encrypted under a different key than "
            f"the one resolved from {encryption.KEY_ENV_VAR} or {encryption.KEY_FILE}. Restore "
            f"that key, or rotate to this one with rotate-app-encryption-key"
        )


async def ensure_key(connection: AsyncConnection) -> None:
    """Generate and persist the encryption key when a deployment has none yet

    Args:
        connection: Open connection used to check whether anything is already encrypted

    Raises:
        RuntimeError: No key is available and this database already holds encrypted secrets
    """
    if bool(os.getenv(encryption.KEY_ENV_VAR)) or encryption.KEY_FILE.exists():
        encryption.resolve_encryption_key(generate=True)
        print("Application encryption key already configured", file=sys.stderr)
        return

    # A schema that exists means this is not a first install, so anything encrypted under
    # the missing key would be lost behind a freshly generated one
    if await _table_exists(connection, _MIGRATION_TABLE) and (
        await read_fingerprint(connection) is not None or await read_stored_secret(connection) is not None
    ):
        raise RuntimeError(
            f"No application encryption key, but this database already holds secrets "
            f"encrypted under one. Set {encryption.KEY_ENV_VAR} to that key. Generating "
            f"one here would leave every stored secret unreadable with nothing reporting it"
        )

    encryption.resolve_encryption_key(generate=True)
    print(f"Generated application encryption key at {encryption.KEY_FILE}", file=sys.stderr)


async def verify_fingerprint(connection: AsyncConnection) -> None:
    """Bind the database to its encryption key, or refuse when the two disagree

    Args:
        connection: Open connection inside a transaction that may record the fingerprint

    Raises:
        RuntimeError: The schema has no fingerprint table, or the resolved key neither
            matches the record nor reads the stored secrets
    """
    key = encryption.resolve_encryption_key(generate=False)
    if not await _table_exists(connection, _FINGERPRINT_TABLE):
        raise RuntimeError(f"No {_FINGERPRINT_TABLE} table. Run the migrations before verifying the key")

    if await read_fingerprint(connection) is not None:
        await verify_key_matches_data(connection)
        return

    # First run after upgrading, so the key in hand becomes the record. It only earns that
    # if it reads what is already stored, since a deployment booting with the wrong key
    # would otherwise have that key recorded as the one its secrets are under
    stored_secret = await read_stored_secret(connection)
    if stored_secret is not None and not decrypts(key, stored_secret):
        raise RuntimeError(
            "Refusing to record the encryption key: it does not decrypt the secrets already "
            f"stored. Set {encryption.KEY_ENV_VAR} to the key they were encrypted under"
        )

    await record_fingerprint(connection, key)
    print("Recorded the encryption key this database's secrets are under", file=sys.stderr)


async def _run_ensure_key() -> None:
    """Run the key check and generation against the admin role"""
    # This runs before the roles are provisioned, so the admin role is the only one there
    engine = create_async_engine(admin_database_url())
    try:
        async with engine.connect() as connection:
            await ensure_key(connection)
    finally:
        await engine.dispose()


async def _run_verify_fingerprint() -> None:
    """Run the fingerprint check against the migrator role, after migrations"""
    engine = create_async_engine(migration_database_url())
    try:
        async with engine.begin() as connection:
            await verify_fingerprint(connection)
    finally:
        await engine.dispose()


_COMMANDS = {
    "ensure-key": _run_ensure_key,
    "verify-fingerprint": _run_verify_fingerprint,
}


def main() -> None:
    """Run the encryption key command named as the single command-line argument"""
    if len(sys.argv) != 2 or sys.argv[1] not in _COMMANDS:
        sys.exit(f"Usage: python -m app.db.encryption_key {{{'|'.join(_COMMANDS)}}}")
    asyncio.run(_COMMANDS[sys.argv[1]]())


if __name__ == "__main__":
    main()
