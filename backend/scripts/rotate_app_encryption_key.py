"""Re-encrypt every stored secret under a new application encryption key"""

import asyncio
import sys

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from app import encryption
from app.config.database import APP_DB_USER, migration_database_url
from app.db.encryption_key import (
    FINGERPRINT_TABLE,
    decrypts,
    read_fingerprint,
    read_stored_secret,
    record_fingerprint,
    table_exists,
)
from app.models import import_all_models
from app.models.base import Base
from app.models.types import find_encrypted_columns

# Proves a key both encrypts and decrypts before any stored secret depends on it
_ROUND_TRIP_PROBE = "encryption key round trip"

# Shown whenever the key does not arrive, since the command reads it from nowhere else
_USAGE = "Usage: docker compose run --rm app rotate-app-encryption-key <new-key>"


class RotationError(RuntimeError):
    """A rotation was refused, leaving nothing committed

    Most of these are raised before the transaction opens. The one raised on a value the
    current key cannot read comes from inside it, after rewrites the rollback takes back
    """


async def _count_app_connections(connection: AsyncConnection) -> int:
    """Return how many other connections the app role holds on this database

    Both predicates matter. pg_stat_activity is cluster-wide, so counting without the
    database would refuse on any cluster hosting a second deployment using these role names
    """
    return await connection.scalar(
        text(
            "SELECT count(*) FROM pg_stat_activity "
            "WHERE usename = :app_user AND datname = current_database() AND pid <> pg_backend_pid()"
        ),
        {"app_user": APP_DB_USER},
    )


async def _refuse_while_the_app_is_running(connection: AsyncConnection) -> None:
    """Raise while the app role still holds a connection to this database

    Raises:
        RotationError: The app is still connected, so a secret written during the rotation
            would be encrypted under the old key onto a row already rewritten
    """
    if await _count_app_connections(connection):
        raise RotationError(
            "Refusing to rotate: the main app appears to be running. Main app must be stopped "
            "before rotating any keys. If you are seeing this after stopping the app, restart "
            "the pg database and try again with key rotation"
        )


async def _rewrite_column(
    connection: AsyncConnection,
    table: str,
    column: str,
    current: Fernet,
    replacement: Fernet,
) -> int:
    """Re-encrypt every value in one column, returning how many rows were rewritten

    Args:
        connection: Open connection inside the rotation transaction
        table: Table holding the column
        column: Column holding Fernet tokens
        current: Fernet built from the key the values are under
        replacement: Fernet built from the key to write them under

    Returns:
        The number of rows rewritten
    """
    # Table and column come from the model metadata rather than any caller, so they are
    # safe to interpolate. FOR UPDATE holds the rows for the life of the transaction, and
    # ctid identifies each one without the rotation needing to know its primary key
    rows = (
        await connection.execute(
            text(f"SELECT ctid, {column} AS value FROM public.{table} WHERE {column} IS NOT NULL FOR UPDATE")  # noqa: S608
        )
    ).all()

    for row in rows:
        try:
            plaintext = current.decrypt(row.value.encode())
        except InvalidToken as error:

            # InvalidToken carries no message, so raising it as it stands would give the
            # operator a traceback naming neither the column nor the fact that the
            # transaction takes every other rewrite back with it
            raise RotationError(
                f"Refusing to rotate: a value in {table}.{column} is not readable with the "
                f"current key, so it is either encrypted under a different key or is not a "
                f"Fernet token at all. Nothing was written"
            ) from error

        await connection.execute(
            text(f"UPDATE public.{table} SET {column} = :value WHERE ctid = :ctid"),  # noqa: S608
            {"value": replacement.encrypt(plaintext).decode(), "ctid": row.ctid},
        )
    return len(rows)


def _check_replacement_key(new_key: str, current_key: str) -> Fernet:
    """Return the Fernet for a new key once it is known to be usable

    Args:
        new_key: The key supplied by the operator
        current_key: The key the stored secrets are under today

    Returns:
        A Fernet built from the new key

    Raises:
        RotationError: The key is malformed, is the current key, or fails a round trip
    """
    if new_key == current_key:
        raise RotationError(
            "Refusing to rotate: the new key is the key already in use, so this would report "
            "success while changing nothing"
        )

    try:
        replacement = Fernet(new_key.encode())
    except (ValueError, TypeError) as error:
        raise RotationError(f"Refusing to rotate: the new key is not a valid Fernet key ({error})") from error

    round_tripped = replacement.decrypt(replacement.encrypt(_ROUND_TRIP_PROBE.encode())).decode()
    if round_tripped != _ROUND_TRIP_PROBE:
        raise RotationError("Refusing to rotate: the new key did not survive a round trip")

    return replacement


async def rotate_encryption_key(engine: AsyncEngine, new_key: str) -> dict[tuple[str, str], int] | None:
    """Re-encrypt every stored secret under a new key, in one transaction

    Args:
        engine: Engine connected as the role owning the encrypted tables
        new_key: The url-safe base64 Fernet key to re-encrypt under

    Returns:
        How many rows were rewritten, keyed by table and column name, or None when the
        secrets were already under the new key and there was nothing to rewrite. A
        rotation over empty tables returns a count of zero for each rather than None

    Raises:
        RotationError: The rotation was refused, leaving nothing committed
    """
    current_key = encryption.resolve_encryption_key(generate=False)
    replacement = _check_replacement_key(new_key, current_key)
    current = Fernet(current_key.encode())

    import_all_models()
    columns = find_encrypted_columns(Base.metadata)

    async with engine.connect() as connection:
        await _refuse_while_the_app_is_running(connection)

        # Checked here rather than at the write, where a missing table would abort the
        # transaction with a bare database error after every row had been re-encrypted
        if not await table_exists(connection, FINGERPRINT_TABLE):
            raise RotationError(
                "Refusing to rotate: this database has no encryption key record. Start the app "
                "once so the migrations run, then rotate"
            )

        stored_secret = await read_stored_secret(connection)
        if stored_secret is not None and not decrypts(current_key, stored_secret):

            # An interrupted rotation commits the data and then fails to clear the stale key
            # file, so the key resolving now is the old one and cannot read anything. Where
            # the new key reads it instead, the work is done and only the file is left
            if decrypts(new_key, stored_secret) and await read_fingerprint(connection) == encryption.key_fingerprint(
                new_key
            ):
                _delete_stale_key_file()
                return None

            raise RotationError(
                f"Refusing to rotate: the key resolved from {encryption.KEY_ENV_VAR} or "
                f"{encryption.KEY_FILE} does not decrypt the stored secrets, so it is not the "
                f"key they are under"
            )

    async with engine.begin() as connection:

        # Re-checked inside the transaction, since the app can reconnect between the first
        # count and here. It narrows the window rather than closing it
        await _refuse_while_the_app_is_running(connection)

        rewritten = {
            (table, column): await _rewrite_column(connection, table, column, current, replacement)
            for table, column in columns
        }
        await record_fingerprint(connection, new_key)

    _delete_stale_key_file()
    return rewritten


def _delete_stale_key_file() -> None:
    """Remove the persisted key, which the rotation has just made the old one

    Nothing writes the new key back. The operator holds it and configures it through the
    environment, so leaving the old file behind would only conflict with what they set
    """
    if not encryption.KEY_FILE.exists():
        return

    encryption.KEY_FILE.unlink()
    print(f"Removed the stale key file at {encryption.KEY_FILE}", file=sys.stderr)


def _print_banner(lines: list[str]) -> None:
    """Print lines inside a block of hashes, so the step left to do is hard to scroll past

    The rotation prints a row count per column, and the one instruction the operator still
    has to act on would otherwise read as one more line among them

    Args:
        lines: Text to frame, one line each, with an empty string for a blank line
    """
    width = max(len(line) for line in lines) + 4
    print("#" * width, file=sys.stderr)
    for line in lines:
        print(f"# {line.ljust(width - 4)} #", file=sys.stderr)
    print("#" * width, file=sys.stderr)


async def _run_rotation(new_key: str) -> None:
    """Rotate against the migrator role and report what was rewritten"""
    engine = create_async_engine(migration_database_url())
    try:
        rewritten = await rotate_encryption_key(engine, new_key)
    finally:
        await engine.dispose()

    if rewritten is None:
        print("The stored secrets were already under this key, so nothing was re-encrypted", file=sys.stderr)
    else:
        for (table, column), count in sorted(rewritten.items()):
            print(f"{table}.{column}: {count} row(s) re-encrypted")

    _print_banner(
        [
            f"Set {encryption.KEY_ENV_VAR} to the new key",
            "before starting the app again!",
        ]
    )


def main() -> None:
    """Rotate every stored secret onto the new key given as the single argument

    The key is visible in the process list while this runs, and in the container's recorded
    command until the container is removed, which `docker compose run --rm` does on exit
    """
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        sys.exit(_USAGE)

    new_key = sys.argv[1].strip()

    try:
        asyncio.run(_run_rotation(new_key))
    except RotationError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
