"""Transaction permission checks"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.permissions.accounts import check_account_access

_LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"
TRANSACTION_WRITE_LOCK_WAIT = "10s"


async def check_transaction_access(
    db: AsyncSession,
    transaction_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
    *,
    lock_for_update: bool = False,
) -> Transaction:
    """Return a transaction when the user can access its account

    Args:
        db: Active database session
        transaction_id: Transaction identifier to check
        user_id: User requesting access
        required_level: Minimum permission level required on the parent account
        lock_for_update: Hold the current row through a write transaction

    Returns:
        Transaction row

    Raises:
        HTTPException: Transaction is missing, inaccessible, or held by another writer too long
    """
    transaction_query = select(Transaction).where(Transaction.id == transaction_id)
    if lock_for_update:
        # Bound only the row-lock read; later snapshot locks keep their existing wait policy
        await db.execute(text(f"SET LOCAL lock_timeout = '{TRANSACTION_WRITE_LOCK_WAIT}'"))
        transaction_query = transaction_query.with_for_update().execution_options(populate_existing=True)

    # Fetch the transaction so access can be delegated to its parent account
    try:
        result = await db.execute(transaction_query)
    except DBAPIError as exc:
        if not lock_for_update or getattr(exc.orig, "sqlstate", None) != _LOCK_NOT_AVAILABLE_SQLSTATE:
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another change reached this transaction first",
        ) from exc
    if lock_for_update:
        await db.execute(text("SET LOCAL lock_timeout = DEFAULT"))
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    await check_account_access(db, transaction.account_id, user_id, required_level)
    return transaction
