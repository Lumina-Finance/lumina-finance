"""Finding which bank transactions an account already holds, by the hash of the bank's own ID"""

import uuid
from collections.abc import Collection

from sqlalchemy import ARRAY, VARCHAR, Uuid, any_, bindparam, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction

# One transaction as its bank names it inside one of the user's accounts: the account, and the hash
# of the bank account the statement names with the bank's ID for the transaction
type BankTransactionKey = tuple[uuid.UUID, str]


async def find_held_bank_transactions(
    db: AsyncSession,
    keys: Collection[BankTransactionKey],
) -> set[BankTransactionKey]:
    """Return the keys whose account already holds a transaction with that bank transaction hash

    The accounts and hashes are bound as one array each rather than one value each, since an import
    can carry 100,000 rows and the driver caps bound values. Matching the pair inside each account
    happens here, as the arrays only narrow the read to the right accounts and hashes

    Args:
        db: Active database session
        keys: Account and bank transaction hash of each transaction to look for

    Returns:
        The keys an account already holds, which is none of them when none was given
    """
    if not keys:
        return set()

    account_ids = bindparam("account_ids", sorted({key[0] for key in keys}), type_=ARRAY(Uuid))
    hashes = bindparam("bank_transaction_hashes", sorted({key[1] for key in keys}), type_=ARRAY(VARCHAR))
    query = select(Transaction.account_id, Transaction.bank_transaction_hash).where(
        Transaction.account_id == any_(account_ids),
        Transaction.bank_transaction_hash == any_(hashes),
    )
    held = {(account_id, bank_transaction_hash) for account_id, bank_transaction_hash in await db.execute(query)}
    return held & set(keys)
