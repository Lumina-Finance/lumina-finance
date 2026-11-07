"""Listing the pending bank transactions shown beside the transaction list

Only the user's own personal accounts have pending items, since only they can be linked. The list
covers the accounts the transaction list is filtered to, or every such account when it isn't, and
is never paged: it holds only what the bank hasn't posted yet. Each sync replaces it
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.user import User
from app.schemas.bank_sync import BankPendingTransactionResponse
from app.services.accounts.access import check_own_personal_accounts, own_personal_account_condition

# Why the list refuses an account the user can see but doesn't own alone
_NOT_OWN_DETAIL = "Pending bank transactions aren't listed for accounts shared with a group"


async def list_pending_transactions(
    db: AsyncSession,
    user: User,
    *,
    account_ids: Sequence[uuid.UUID] | None,
) -> list[BankPendingTransactionResponse]:
    """Return the pending bank transactions of some of the user's accounts, or of all of them

    Args:
        db: Active database session
        user: The user reading them
        account_ids: The accounts whose items to list, or None for every account

    Returns:
        The items, newest first by the bank's date

    Raises:
        HTTPException 403: An account is visible but isn't the user's own personal account
        HTTPException 404: An account isn't visible to the user
    """
    scope = [own_personal_account_condition(user.id)]
    if account_ids is not None:
        await check_own_personal_accounts(db, account_ids, user.id, not_own_detail=_NOT_OWN_DETAIL)
        scope.append(BankPendingTransaction.account_id.in_(account_ids))

    items = await db.scalars(
        select(BankPendingTransaction)
        .join(Account, Account.id == BankPendingTransaction.account_id)
        .where(*scope)
        .order_by(BankPendingTransaction.transaction_date.desc(), BankPendingTransaction.id.desc())
    )
    return [
        BankPendingTransactionResponse(
            id=item.id,
            account_id=item.account_id,
            date=item.transaction_date,
            amount=item.amount,
            raw_amount=item.raw_amount,
            description=item.description,
            observed_at=item.observed_at,
        )
        for item in items
    ]
