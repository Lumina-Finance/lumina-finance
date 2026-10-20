"""Provision the bank transaction hash key, refusing to replace one the database's hashes were made with"""

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app import bank_transaction_key
from app.config.database import admin_database_url


async def holds_bank_transaction_hashes(connection: AsyncConnection) -> bool:
    """Whether any transaction already carries a bank transaction hash

    A schema from before the hash has no such column, and its bank IDs are hashed by the migration
    under whichever key is in place when it runs, so it depends on no key yet

    Args:
        connection: Open connection to the application database
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
    """Generate and persist the key when the deployment has none and nothing depends on one yet

    Args:
        connection: Open connection used to check for saved hashes

    Raises:
        RuntimeError: No key is available and the database either holds hashes made with one or
            could not be checked for them
    """
    if bank_transaction_key.is_key_available():
        bank_transaction_key.resolve_key(generate=False)
        print("Bank transaction hash key already configured", file=sys.stderr)
        return

    env_var, key_file = bank_transaction_key.KEY_ENV_VAR, bank_transaction_key.KEY_FILE
    try:
        depends_on_key = await holds_bank_transaction_hashes(connection)
    except SQLAlchemyError as error:
        # Run as the admin role, which may be unable to read the table. Minting a key is what would
        # break the saved hashes, so refusing is the safe answer
        raise RuntimeError(
            f"No {env_var}, and this database could not be checked for bank transaction hashes "
            f"({error}). Set {env_var} rather than having one generated here"
        ) from error

    # A new key would match none of the saved hashes, so every statement imported again would bring
    # back the transactions already saved from it, with nothing reporting why
    if depends_on_key:
        raise RuntimeError(
            f"No {env_var}, but this database holds bank transaction hashes made with one. Restore "
            f"that key to {env_var} or {key_file} rather than having a new one generated"
        )

    bank_transaction_key.resolve_key(generate=True)
    print(f"Generated bank transaction hash key at {key_file}", file=sys.stderr)


async def _run_ensure_key() -> None:
    """Run the check and generation against the admin role, before the managed roles exist"""
    engine = create_async_engine(admin_database_url())
    try:
        async with engine.connect() as connection:
            await ensure_key(connection)
    finally:
        await engine.dispose()


def main() -> None:
    """Run the one command this module takes, ensure-key"""
    if sys.argv[1:] != ["ensure-key"]:
        sys.exit("Usage: python -m app.db.bank_transaction_key ensure-key")
    asyncio.run(_run_ensure_key())


if __name__ == "__main__":
    main()
