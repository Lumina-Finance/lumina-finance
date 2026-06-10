"""Merchant access route helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.group import GroupMember
from app.models.merchant import Merchant
from app.routes.merchants.scope_filter_helpers import (
    get_accessible_merchant_filter,
    get_default_category_scope_filter,
)


async def get_accessible_merchant_or_404(db: AsyncSession, merchant_id: uuid.UUID, user_id: uuid.UUID) -> Merchant:
    """Return a merchant visible to the user or raise not found

    Args:
        db: Active database session
        merchant_id: Merchant identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Merchant visible to the user

    Raises:
        HTTPException: Merchant is missing or not visible to the user
    """
    merchant_filter = get_accessible_merchant_filter(user_id)

    # Fetch the merchant only when it is visible to the requesting user
    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            merchant_filter,
        ),
    )
    merchant = result.scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    return merchant


async def require_group_member(db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Raise not found when a user is not a group member

    Args:
        db: Active database session
        group_id: Group identifier from the request
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User is not a member of the group
    """
    membership_filter = (
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch group membership so group-scoped merchant operations reject outsiders
    member_result = await db.execute(
        select(GroupMember).where(*membership_filter),
    )
    is_group_member = member_result.scalar_one_or_none() is not None
    if not is_group_member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")


async def require_group_merchant_admin(db: AsyncSession, merchant: Merchant, user_id: uuid.UUID) -> None:
    """Raise forbidden when a group merchant change is not made by an admin

    Personal merchants do not require group admin checks

    Args:
        db: Active database session
        merchant: Merchant being changed
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User is not an admin for the merchant's group
    """
    if merchant.group_id is None:
        return

    # Fetch group membership so group-scoped merchant changes require an admin
    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == merchant.group_id,
            GroupMember.user_id == user_id,
        ),
    )
    member = member_result.scalar_one_or_none()
    if not member or not member.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


async def require_merchant_name_available(
    db: AsyncSession,
    name: str,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
) -> None:
    """Raise a conflict response when a merchant name is already used

    Args:
        db: Active database session
        name: Requested merchant name
        user_id: User identifier for personal merchant scope
        group_id: Optional group identifier for group merchant scope

    Raises:
        HTTPException: Merchant name already exists in the target scope
    """
    duplicate_query = select(Merchant).where(Merchant.name == name)
    if group_id:
        duplicate_query = duplicate_query.where(Merchant.group_id == group_id)
    else:
        duplicate_query = duplicate_query.where(Merchant.owner_id == user_id, Merchant.group_id.is_(None))

    # Check whether the target scope already has a merchant with the requested name
    has_duplicate = (await db.execute(duplicate_query)).scalar_one_or_none() is not None
    if has_duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Merchant with this name already exists")


async def require_default_category_available(
    db: AsyncSession,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    default_category_id: uuid.UUID | None,
) -> None:
    """Raise when a merchant default category is unavailable

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        group_id: Optional merchant group identifier
        default_category_id: Optional category identifier to validate

    Raises:
        HTTPException: Category is missing or outside the merchant scope
    """
    if default_category_id is None:
        return

    category_filter = get_default_category_scope_filter(user_id, group_id)

    # Fetch the default category only when it is valid for the merchant's personal or group scope
    category_result = await db.execute(
        select(Category).where(
            Category.id == default_category_id,
            category_filter,
        ),
    )
    has_category = category_result.scalar_one_or_none() is not None
    if not has_category:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
