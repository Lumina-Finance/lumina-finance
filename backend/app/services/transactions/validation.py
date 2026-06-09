"""Transaction related-entity validation services"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag


async def validate_transaction_category_access(
    db: AsyncSession,
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None = None,
) -> None:
    """Ensure a transaction can use the requested category

    Personal-account transactions may use system categories and the user's own
    personal categories. Group-account transactions may also use categories
    owned by the account's group. Categories from another user's personal scope
    or an unrelated group are rejected

    Args:
        db: Active database session
        category_id: Category identifier submitted on the transaction
        user_id: User identifier creating or updating the transaction
        group_id: Optional group identifier from the transaction account

    Raises:
        HTTPException: Category is missing or outside the transaction account scope
    """
    # Build a category lookup that accepts only categories valid for the transaction account scope
    query = select(Category).where(Category.id == category_id)
    if group_id is not None:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None)))
            | (Category.group_id == group_id),
        )
    else:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )

    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")


async def validate_transaction_merchant_access(
    db: AsyncSession,
    merchant_id: uuid.UUID,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None = None,
) -> None:
    """Ensure a transaction can use the requested merchant

    Personal-account transactions may use only the user's personal merchants.
    Group-account transactions may also use merchants owned by the account's
    group. Merchants from another user's personal scope or an unrelated group
    are rejected

    Args:
        db: Active database session
        merchant_id: Merchant identifier submitted on the transaction
        user_id: User identifier creating or updating the transaction
        group_id: Optional group identifier from the transaction account

    Raises:
        HTTPException: Merchant is missing or outside the transaction account scope
    """
    # Build a merchant lookup that accepts only merchants valid for the transaction account scope
    query = select(Merchant).where(Merchant.id == merchant_id)
    if group_id is not None:
        query = query.where(
            ((Merchant.owner_id == user_id) & (Merchant.group_id.is_(None))) | (Merchant.group_id == group_id),
        )
    else:
        query = query.where(Merchant.owner_id == user_id, Merchant.group_id.is_(None))

    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Merchant not found")


async def get_valid_transaction_tag_ids(
    db: AsyncSession,
    user_id: uuid.UUID,
    tag_ids: list[uuid.UUID],
    group_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Return tag identifiers a transaction can safely attach

    The submitted tag list is deduplicated while preserving order. Personal
    accounts may attach the user's personal tags, while group accounts may also
    attach tags owned by the account's group. Any missing or out-of-scope tag
    rejects the whole request

    Args:
        db: Active database session
        user_id: User identifier creating or updating the transaction
        tag_ids: Tag identifiers submitted on the transaction
        group_id: Optional group identifier from the transaction account

    Returns:
        Deduplicated tag identifiers that preserve the submitted order

    Raises:
        HTTPException: At least one tag is missing or outside the transaction account scope
    """
    # Deduplicate to avoid inserting duplicate transaction-tag links
    unique_tag_ids = list(dict.fromkeys(tag_ids))
    tag_filter = (Tag.owner_id == user_id) & (Tag.group_id.is_(None))
    if group_id is not None:
        tag_filter = tag_filter | (Tag.group_id == group_id)

    # Fetch tags visible in the transaction account's personal or group scope
    result = await db.execute(
        select(Tag.id).where(Tag.id.in_(unique_tag_ids), tag_filter),
    )
    found_tag_ids = set(result.scalars().all())
    if found_tag_ids != set(unique_tag_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Tag not found")
    return unique_tag_ids
