"""Finding which bank transactions an account already holds, by the bank's own ID"""

import uuid
from collections.abc import Collection

from sqlalchemy import ARRAY, VARCHAR, Uuid, any_, bindparam, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction

# One transaction as its bank names it inside one of the user's accounts: the account, the bank
# account the statement names, and the bank's ID for the transaction
type BankTransactionKey = tuple[uuid.UUID, str, str]


async def find_held_bank_transactions(
    db: AsyncSession,
    keys: Collection[BankTransactionKey],
) -> set[BankTransactionKey]:
    """Return the keys whose account already holds a transaction with that bank account and ID

    The accounts and IDs are bound as one array each rather than one value each, since an import
    can carry 100,000 rows and the driver caps bound values. Matching the pair inside each account
    happens here, as the arrays only narrow the read to the right accounts and IDs

    Args:
        db: Active database session
        keys: Account, bank account key and bank transaction ID of each transaction to look for

    Returns:
        The keys an account already holds, which is none of them when none was given
    """
    if not keys:
        return set()

    account_ids = bindparam("account_ids", sorted({key[0] for key in keys}), type_=ARRAY(Uuid))
    bank_transaction_ids = bindparam("bank_transaction_ids", sorted({key[2] for key in keys}), type_=ARRAY(VARCHAR))
    query = select(Transaction.account_id, Transaction.bank_account_key, Transaction.bank_transaction_id).where(
        Transaction.account_id == any_(account_ids),
        Transaction.bank_transaction_id == any_(bank_transaction_ids),
    )
    held = {(account_id, account_key, transaction_id) for account_id, account_key, transaction_id in await db.execute(query)}
    return held & set(keys)
