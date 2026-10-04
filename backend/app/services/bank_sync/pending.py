"""Replacing an account's pending bank transactions"""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_pending_transaction import BankPendingTransaction


async def replace_pending_transactions(
    db: AsyncSession,
    account_id: uuid.UUID,
    pending: Sequence[BankPendingTransaction],
) -> None:
    """Replace an account's pending set wholesale with what the bank reports now

    Items that posted or that the bank dropped disappear without being matched, and an empty set
    clears the account. Other accounts' sets are left alone, so an account whose part of a fetch
    failed keeps the items it had. The caller commits

    Args:
        db: Active database session
        account_id: Account whose set is replaced
        pending: The unsaved items the bank reports now, all for this account
    """
    await db.execute(delete(BankPendingTransaction).where(BankPendingTransaction.account_id == account_id))
    db.add_all(pending)
    await db.flush()
