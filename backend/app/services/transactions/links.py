"""Links between a refund and the expense it refunds"""

import uuid
from collections.abc import Collection

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

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


async def get_refunded_amounts(db: AsyncSession, original_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Return how much of each expense its linked refunds already give back

    Only refunds in the expense's own currency count, since amounts in two currencies can't be added

    Args:
        db: Active database session
        original_ids: Expenses to total the refunds of

    Returns:
        The refunded total in minor units, keyed by expense. An expense with none is absent
    """
    if not original_ids:
        return {}
    original = aliased(Transaction)
    rows = (
        await db.execute(
            select(TransactionLink.original_transaction_id, func.sum(Transaction.amount))
            .join(Transaction, Transaction.id == TransactionLink.refund_transaction_id)
            .join(original, original.id == TransactionLink.original_transaction_id)
            .where(TransactionLink.original_transaction_id.in_(original_ids), Transaction.currency == original.currency)
            .group_by(TransactionLink.original_transaction_id),
        )
    ).all()
    return {row[0]: int(row[1]) for row in rows}


async def validate_refund_original(
    db: AsyncSession,
    user: User,
    original_id: uuid.UUID,
    refund_amount: int,
    refund_currency: str,
    refund_account: Account,
    refund_category: Category,
) -> Transaction:
    """Load the expense a transaction refunds and refuse a pairing that is not a refund

    Args:
        db: Active database session
        user: Authenticated user creating the refund
        original_id: Transaction the refund refunds
        refund_amount: Amount of the refund in minor units
        refund_currency: Currency of the refund
        refund_account: Account the refund is recorded in
        refund_category: Category the refund is filed under

    Returns:
        The expense being refunded

    Raises:
        HTTPException: 404 when the expense is missing or not the user's, 422 when the expense is not
            an outflow in an expense category, the refund is not an inflow or is a transfer, either
            account is in a group, or its refunds would total more than the expense
    """
    # Locked so an edit or delete of the expense cannot slip past the link being made
    original = await check_transaction_access(db, original_id, user.id, PermissionLevel.READ, lock_for_update=True)
    original_account = await get_parent_account_for_transaction(db, original)
    validate_transaction_account_is_not_archived(original_account)
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
    # A transfer is not spending or income, so it is never the refund of an expense
    if refund_category.kind == CategoryKind.TRANSFER:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A transfer can't be a refund",
        )

    # The expense is locked above, so no other link can add to this total before this one commits
    if refund_currency == original.currency:
        already_refunded = (await get_refunded_amounts(db, [original.id])).get(original.id, 0)
        if already_refunded + refund_amount > -original.amount:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Refunds can't total more than the expense they refund",
            )
    return original


async def refuse_broken_links(db: AsyncSession, transaction_ids: Collection[uuid.UUID]) -> None:
    """Refuse an edit that leaves a link joining something other than a refund to an expense

    Called after the edit is written and before it commits, so the rolled-back request changes nothing

    Args:
        db: Active database session
        transaction_ids: Transactions the edit wrote

    Raises:
        HTTPException: 422 when a link of one of them no longer joins an inflow, outside a transfer
            category, to an outflow in an expense category, or reaches a group account
    """
    refund = aliased(Transaction)
    original = aliased(Transaction)
    refund_account = aliased(Account)
    original_account = aliased(Account)
    refund_category = aliased(Category)
    original_category = aliased(Category)
    broken = (
        await db.execute(
            select(TransactionLink.id)
            .join(refund, refund.id == TransactionLink.refund_transaction_id)
            .join(original, original.id == TransactionLink.original_transaction_id)
            .join(refund_account, refund_account.id == refund.account_id)
            .join(original_account, original_account.id == original.account_id)
            .join(refund_category, refund_category.id == refund.category_id)
            .join(original_category, original_category.id == original.category_id)
            .where(
                TransactionLink.refund_transaction_id.in_(transaction_ids) | TransactionLink.original_transaction_id.in_(transaction_ids),
                (refund.amount <= 0)
                | (original.amount >= 0)
                | (refund_category.kind == CategoryKind.TRANSFER)
                | (original_category.kind != CategoryKind.EXPENSE)
                | refund_account.group_id.is_not(None)
                | original_account.group_id.is_not(None),
            )
            .limit(1),
        )
    ).first()
    if broken is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "A refund link needs money in that isn't a transfer, and an expense in an expense category that is money out, "
                "and neither can be in a group account. Unlink it first to make this change"
            ),
        )

    # Every refund of an expense an edit touched counts, not only the ones it wrote
    touched_originals = select(TransactionLink.original_transaction_id).where(
        TransactionLink.refund_transaction_id.in_(transaction_ids) | TransactionLink.original_transaction_id.in_(transaction_ids),
    )
    over_refunded = (
        await db.execute(
            select(TransactionLink.original_transaction_id)
            .join(refund, refund.id == TransactionLink.refund_transaction_id)
            .join(original, original.id == TransactionLink.original_transaction_id)
            .where(TransactionLink.original_transaction_id.in_(touched_originals), refund.currency == original.currency)
            .group_by(TransactionLink.original_transaction_id, original.amount)
            .having(func.sum(refund.amount) > -original.amount)
            .limit(1),
        )
    ).first()
    if over_refunded is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Refunds can't total more than the expense they refund. Unlink one first to make this change",
        )


async def link_existing_refund(
    db: AsyncSession,
    user: User,
    refund_id: uuid.UUID,
    original_id: uuid.UUID,
) -> None:
    """Link a transaction that already exists, as the refund of an expense

    Args:
        db: Active database session
        user: Authenticated user linking them
        refund_id: The refund, money coming in
        original_id: The expense it refunds

    Raises:
        HTTPException: 404 when either is missing or not the user's, 409 when the refund is already
            linked, and 422 when they are the same transaction, the pairing is not a refund, or they
            are in different currencies
    """
    refund = await check_transaction_access(db, refund_id, user.id, PermissionLevel.WRITE, lock_for_update=True)
    refund_account = await get_parent_account_for_transaction(db, refund)
    validate_transaction_account_is_not_archived(refund_account)
    if refund_id == original_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A transaction can't refund itself")
    if (await db.execute(select(TransactionLink.id).where(TransactionLink.refund_transaction_id == refund_id))).first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This refund is already linked to an expense")
    refund_category = await db.get(Category, refund.category_id)
    original = await validate_refund_original(db, user, original_id, refund.amount, refund.currency, refund_account, refund_category)
    if refund.currency != original.currency:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A refund can only be linked to an expense in its own currency",
        )

    db.add(TransactionLink(refund_transaction_id=refund_id, original_transaction_id=original_id))
    await db.flush()

    # Both accounts are the user's own, so one scope holds every list showing the link
    await mark_cache_changed_for_scope(db, user_id=refund_account.owner_id, group_id=refund_account.group_id)
    await db.commit()


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

    await db.execute(delete(TransactionLink).where(TransactionLink.id == link.id))
    await db.flush()

    # Both accounts are the user's own, so one scope holds every list showing the link
    await mark_cache_changed_for_scope(db, user_id=refund_account.owner_id, group_id=refund_account.group_id)
    await db.commit()
