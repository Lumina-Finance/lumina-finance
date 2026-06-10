"""Category access route helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.group import GroupMember
from app.routes.categories.category_scope_filter_helpers import (
    get_accessible_category_filter,
    get_category_name_conflict_filter,
)

VALID_CATEGORY_KINDS = {category_kind.value for category_kind in CategoryKind}


def is_valid_category_kind(category_kind: str) -> bool:
    """Return whether a category kind is supported

    Args:
        category_kind: Category kind value from the request payload

    Returns:
        True when the category kind is supported
    """
    is_valid_kind = category_kind in VALID_CATEGORY_KINDS
    return is_valid_kind


async def require_category_name_available(
    db: AsyncSession,
    name: str,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    exclude_category_id: uuid.UUID | None = None,
) -> None:
    """Raise a conflict response when a category name is already used

    Args:
        db: Active database session
        name: Requested category name
        user_id: User identifier for personal category scope
        group_id: Optional group identifier for group category scope
        exclude_category_id: Optional category identifier ignored during rename checks

    Raises:
        HTTPException: Category name already exists in the target scope
    """
    conflict_filter = get_category_name_conflict_filter(name, user_id, group_id)

    # Check whether the target scope already has a category with the requested name
    conflict_query = select(Category.id).where(conflict_filter).limit(1)
    if exclude_category_id is not None:
        conflict_query = conflict_query.where(Category.id != exclude_category_id)

    has_conflict = (await db.execute(conflict_query)).scalar_one_or_none() is not None
    if has_conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category with this name already exists")


async def get_accessible_category_or_404(db: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID) -> Category:
    """Return a category visible to the user or raise not found

    Args:
        db: Active database session
        category_id: Category identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Category visible to the user

    Raises:
        HTTPException: Category is missing or not visible to the user
    """
    category_filter = get_accessible_category_filter(user_id)

    # Fetch the category only when it is visible to the requesting user
    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            category_filter,
        ),
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return category


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

    # Fetch group membership so group-scoped category operations reject outsiders
    member_result = await db.execute(
        select(GroupMember).where(*membership_filter),
    )
    is_group_member = member_result.scalar_one_or_none() is not None
    if not is_group_member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")


async def require_group_category_admin(db: AsyncSession, category: Category, user_id: uuid.UUID) -> None:
    """Raise forbidden when a group category change is not made by an admin

    Personal categories do not require group admin checks

    Args:
        db: Active database session
        category: Category being changed
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User is not an admin for the category's group
    """
    if category.group_id is None:
        return

    # Fetch group membership so group-scoped category changes require an admin
    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == category.group_id,
            GroupMember.user_id == user_id,
        ),
    )
    member = member_result.scalar_one_or_none()
    if not member or not member.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
