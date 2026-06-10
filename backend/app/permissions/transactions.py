"""Transaction permission checks"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.permissions.accounts import check_account_access


async def check_transaction_access(
    db: AsyncSession,
    transaction_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
) -> Transaction:
    """Return a transaction when the user can access its account

    Args:
        db: Active database session
        transaction_id: Transaction identifier to check
        user_id: User requesting access
        required_level: Minimum permission level required on the parent account

    Returns:
        Transaction row

    Raises:
        HTTPException: Transaction is missing or its parent account is inaccessible
    """
    transaction_query = select(Transaction).where(Transaction.id == transaction_id)

    # Fetch the transaction so access can be delegated to its parent account
    result = await db.execute(transaction_query)
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    await check_account_access(db, transaction.account_id, user_id, required_level)
    return transaction
