"""Links between a refund and the expense it refunds"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind, PermissionLevel
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User
from app.permissions import check_transaction_access
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.transactions.accounts import (
    get_parent_account_for_transaction,
    validate_transaction_account_is_not_archived,
)


async def get_transaction_links_batch(
    db: AsyncSession,
    transaction_ids: list[uuid.UUID],
) -> tuple[dict[uuid.UUID, uuid.UUID], dict[uuid.UUID, list[uuid.UUID]]]:
    """Return the links of a set of transactions in both directions with one query

    Args:
        db: Active database session
        transaction_ids: Transactions whose links should be loaded

    Returns:
        The expense each refund refunds, keyed by refund, and the refunds of each expense, keyed by
        expense and oldest first. A transaction with no link is absent from both
    """
    if not transaction_ids:
        return {}, {}

    # One query for both directions, since a page holds expenses and refunds side by side
    rows = (
        await db.execute(
            select(TransactionLink.refund_transaction_id, TransactionLink.original_transaction_id)
            .where(
                TransactionLink.refund_transaction_id.in_(transaction_ids) | TransactionLink.original_transaction_id.in_(transaction_ids),
            )
            .order_by(TransactionLink.created_at, TransactionLink.id),
        )
    ).all()
    original_by_refund = {row.refund_transaction_id: row.original_transaction_id for row in rows}
    refunds_by_original: dict[uuid.UUID, list[uuid.UUID]] = {}
    for row in rows:
        refunds_by_original.setdefault(row.original_transaction_id, []).append(row.refund_transaction_id)
    return original_by_refund, refunds_by_original


async def validate_refund_original(
    db: AsyncSession,
    user: User,
    original_id: uuid.UUID,
    refund_amount: int,
    refund_account: Account,
) -> Transaction:
    """Load the expense a new transaction refunds and refuse a pairing that is not a refund

    Args:
        db: Active database session
        user: Authenticated user creating the refund
        original_id: Transaction the new one refunds
        refund_amount: Amount of the new transaction in minor units
        refund_account: Account the refund is recorded in

    Returns:
        The expense being refunded

    Raises:
        HTTPException: 404 when the expense is missing or not the user's, 422 when the expense is not
            an outflow in an expense category, the refund is not an inflow, or either account is in a group
    """
    original = await check_transaction_access(db, original_id, user.id, PermissionLevel.READ)
    original_account = await get_parent_account_for_transaction(db, original)
    if original_account.group_id is not None or refund_account.group_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Refunds can't be linked in group accounts",
        )
    category = await db.get(Category, original.category_id)
    if original.amount >= 0 or category is None or category.kind != CategoryKind.EXPENSE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only an expense can be refunded",
        )
    if refund_amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A refund must be money coming in",
        )
    return original


async def unlink_refund(db: AsyncSession, user: User, refund_id: uuid.UUID) -> None:
    """Remove the link between a refund and its expense, leaving both transactions as they are

    Args:
        db: Active database session
        user: Authenticated user unlinking the refund
        refund_id: The refund whose link is removed

    Raises:
        HTTPException: 404 when the transaction is missing or not the user's, or has no link
    """
    refund = await check_transaction_access(db, refund_id, user.id, PermissionLevel.WRITE, lock_for_update=True)
    refund_account = await get_parent_account_for_transaction(db, refund)
    validate_transaction_account_is_not_archived(refund_account)

    link = (
        await db.execute(
            select(TransactionLink).where(TransactionLink.refund_transaction_id == refund_id),
        )
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    # The expense may sit in another account and scope, whose cached lists show the link too
    original = await db.get(Transaction, link.original_transaction_id)
    original_account = await get_parent_account_for_transaction(db, original) if original else refund_account

    await db.execute(delete(TransactionLink).where(TransactionLink.id == link.id))
    await db.flush()
    for scope_account in {refund_account, original_account}:
        await mark_cache_changed_for_scope(db, user_id=scope_account.owner_id, group_id=scope_account.group_id)
    await db.commit()
