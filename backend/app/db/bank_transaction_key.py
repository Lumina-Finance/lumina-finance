"""Provision the bank transaction hash key and bind it to the hashes made with it

The database records the key's fingerprint, written by the migration that introduced the hashes.
The app refuses to start under any other key, and provisioning refuses to generate one over a
database that has a key. An operator who has lost the key accepts the cost of a new one with
reset-key: every statement imported again then brings back the transactions already saved from it
"""

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app import bank_transaction_key
from app.config.database import admin_database_url
from app.db.encryption_key import table_exists
from app.models.encryption_key import SINGLETON_ID

FINGERPRINT_TABLE = "bank_transaction_key_fingerprint"

# What the container's maintenance command is called, run with the stack stopped
RESET_COMMAND = "docker compose run --rm app reset-bank-transaction-hash-key"


def _way_forward() -> str:
    """Say how to recover, and what the one way that keeps no key costs"""
    return (
        f"Restore that key to {bank_transaction_key.KEY_ENV_VAR} or {bank_transaction_key.KEY_FILE}. "
        f"If it is lost, run `{RESET_COMMAND}` to start over with the key now set, or a new one, and "
        f"accept that statements imported again will bring back the transactions already saved from them"
    )


async def read_fingerprint(connection: AsyncConnection) -> str | None:
    """Return the recorded key fingerprint, or None before the migration that records one"""
    if not await table_exists(connection, FINGERPRINT_TABLE):
        return None
    return await connection.scalar(
        text(f"SELECT fingerprint FROM public.{FINGERPRINT_TABLE} WHERE id = :id"),  # noqa: S608
        {"id": SINGLETON_ID},
    )


async def holds_bank_transaction_hashes(connection: AsyncConnection) -> bool:
    """Whether any transaction already carries a bank transaction hash

    A schema from before the hash has no such column, and its bank IDs are hashed by the migration
    under whichever key is in place when it runs, so it depends on no key yet
    """
    has_column = await connection.scalar(
        text(
            "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public'"
            " AND table_name = 'transactions' AND column_name = 'bank_transaction_hash')"
        )
    )
    if not has_column:
        return False
    return await connection.scalar(text("SELECT EXISTS (SELECT FROM public.transactions WHERE bank_transaction_hash IS NOT NULL)"))


async def ensure_key(connection: AsyncConnection) -> None:
    """Generate and persist the key when the deployment has none and the database has none either

    A key that is set or persisted is only checked to be well formed here. Whether it is the one
    the hashes were made with is checked at every start, by verify_key_matches_hashes

    Args:
        connection: Open connection used to check for a recorded key or saved hashes

    Raises:
        RuntimeError: No key is available and the database records one or holds hashes made with
            one, or could not be checked
    """
    if bank_transaction_key.is_key_available():
        bank_transaction_key.resolve_key(generate=False)
        print("Bank transaction hash key already configured", file=sys.stderr)
        return

    env_var = bank_transaction_key.KEY_ENV_VAR
    try:
        depends_on_key = await read_fingerprint(connection) is not None or await holds_bank_transaction_hashes(connection)
    except SQLAlchemyError as error:
        # Run as the admin role, which may be unable to read the tables. Minting a key is what
        # would break the saved hashes, so refusing is the safe answer
        raise RuntimeError(
            f"No {env_var}, and this database could not be checked for a key it depends on "
            f"({error}). Set {env_var} rather than having one generated here"
        ) from error

    if depends_on_key:
        raise RuntimeError(f"No {env_var}, but this database's bank transaction hashes were made with one. {_way_forward()}")

    bank_transaction_key.resolve_key(generate=True)
    print(f"Generated bank transaction hash key at {bank_transaction_key.KEY_FILE}", file=sys.stderr)


async def verify_key_matches_hashes(connection: AsyncConnection) -> None:
    """Raise when the key in hand is not the one the database's hashes were made with

    Args:
        connection: Open connection to the application database

    Raises:
        RuntimeError: There is no key, or the recorded fingerprint names another
    """
    key = bank_transaction_key.resolve_key(generate=False)
    recorded = await read_fingerprint(connection)
    if recorded is not None and recorded != bank_transaction_key.key_fingerprint(key):
        raise RuntimeError(
            f"Refusing to start: the bank transaction hashes were made with a different key than the "
            f"one in {bank_transaction_key.KEY_ENV_VAR} or {bank_transaction_key.KEY_FILE}. {_way_forward()}"
        )


async def reset_key(connection: AsyncConnection) -> None:
    """Bind the database to the key now set, or a newly generated one, giving up the old hashes

    The transactions keep their old hashes, which no statement will match again, so each one
    imported again is brought in as new

    Args:
        connection: Open connection inside the transaction that records the key
    """
    key = bank_transaction_key.resolve_key(generate=True)
    await connection.execute(
        text(
            f"INSERT INTO public.{FINGERPRINT_TABLE} (id, fingerprint) VALUES (:id, :fingerprint) "  # noqa: S608
            f"ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, updated_at = now()"
        ),
        {"id": SINGLETON_ID, "fingerprint": bank_transaction_key.key_fingerprint(key)},
    )
    print(
        "Recorded the bank transaction hash key now in use. Statements imported again will bring back the transactions already saved from them",
        file=sys.stderr,
    )


async def _run(command) -> None:
    """Run a command against the admin role, which exists before the managed roles are provisioned"""
    engine = create_async_engine(admin_database_url())
    try:
        async with engine.begin() as connection:
            await command(connection)
    finally:
        await engine.dispose()


_COMMANDS = {"ensure-key": ensure_key, "reset-key": reset_key}


def main() -> None:
    """Run the command named as the single command-line argument"""
    if len(sys.argv) != 2 or sys.argv[1] not in _COMMANDS:
        sys.exit(f"Usage: python -m app.db.bank_transaction_key {{{'|'.join(_COMMANDS)}}}")
    asyncio.run(_run(_COMMANDS[sys.argv[1]]))


if __name__ == "__main__":
    main()
