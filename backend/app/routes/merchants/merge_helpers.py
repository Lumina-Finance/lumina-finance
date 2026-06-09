"""Merchant merge route helpers"""
import uuid

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.routes.merchants.access_helpers import get_personal_merchant_filter


async def get_merge_replacement_merchant(
    db: AsyncSession,
    source_merchant: Merchant,
    replacement_merchant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Merchant:
    """Return the valid replacement merchant for a merge

    Args:
        db: Active database session
        source_merchant: Merchant being merged away
        replacement_merchant_id: Requested replacement merchant identifier
        user_id: Authenticated user identifier

    Returns:
        Replacement merchant for the merge

    Raises:
        HTTPException: Replacement merchant is invalid or missing
    """
    if source_merchant.id == replacement_merchant_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement merchant must be different",
        )

    replacement_filter = Merchant.id == replacement_merchant_id
    if source_merchant.group_id is None:
        replacement_filter = replacement_filter & get_personal_merchant_filter(user_id)
    else:
        replacement_filter = replacement_filter & (Merchant.group_id == source_merchant.group_id)

    # Fetch a replacement merchant from the same scope as the merchant being merged
    replacement_result = await db.execute(select(Merchant).where(replacement_filter))
    replacement = replacement_result.scalar_one_or_none()
    if not replacement:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement merchant not found",
        )
    return replacement


async def move_merchant_references(
    db: AsyncSession,
    source_merchant_id: uuid.UUID,
    replacement_merchant_id: uuid.UUID,
) -> None:
    """Move transaction references from a source merchant to a replacement

    Args:
        db: Active database session
        source_merchant_id: Merchant being merged away
        replacement_merchant_id: Merchant receiving the transaction references
    """
    update_statement = (
        sa.update(Transaction)
        .where(Transaction.merchant_id == source_merchant_id)
        .values(merchant_id=replacement_merchant_id)
    )

    # Move source transactions to the replacement merchant
    await db.execute(update_statement)
