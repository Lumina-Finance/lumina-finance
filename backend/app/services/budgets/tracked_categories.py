"""Tracked category validation shared by budget routes and importers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category


async def get_valid_tracked_category_ids(
    db: AsyncSession,
    category_ids: list[uuid.UUID],
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """Return tracked category identifiers allowed for a base budget

    Scope rules:
    - Personal base budget: system categories or the user's own personal categories
    - Group base budget: system categories or categories owned by the same group

    Mixing scopes is rejected so every group member sees the same tracked-category set and totals

    Args:
        db: Active database session
        category_ids: Requested tracked category identifiers
        user_id: Authenticated user identifier
        group_id: Optional group scope for the base budget

    Returns:
        Deduplicated tracked category identifiers

    Raises:
        HTTPException: A category is missing or outside the base budget scope
    """
    if not category_ids:
        return []

    # Deduplicate before querying so repeated IDs are not treated as missing
    unique_category_ids = list(set(category_ids))
    found_category_ids = await get_allowed_tracked_category_ids(db, unique_category_ids, user_id, group_id)

    # Missing and out-of-scope categories use the same client-facing validation error
    if found_category_ids != set(unique_category_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return unique_category_ids


async def get_allowed_tracked_category_ids(
    db: AsyncSession,
    category_ids: list[uuid.UUID],
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
) -> set[uuid.UUID]:
    """Return requested category identifiers allowed for a budget scope

    Args:
        db: Active database session
        category_ids: Requested tracked category identifiers
        user_id: Authenticated user identifier
        group_id: Optional group scope for the base budget

    Returns:
        Allowed category identifiers without rejecting missing or forbidden IDs
    """
    if not category_ids:
        return set()

    # Fetch only categories eligible for the requested budget scope
    query = select(Category.id).where(Category.id.in_(set(category_ids)))

    # Match categories allowed by the budget scope
    system_category_filter = Category.is_system.is_(True)
    if group_id is not None:
        query = query.where(system_category_filter | (Category.group_id == group_id))
    else:
        personal_category_filter = (Category.owner_id == user_id) & (Category.group_id.is_(None))
        query = query.where(
            system_category_filter | personal_category_filter,
        )

    # Fetch categories that are valid for the base budget scope
    result = await db.execute(query)
    return set(result.scalars().all())
