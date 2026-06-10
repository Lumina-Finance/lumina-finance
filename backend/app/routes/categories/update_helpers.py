"""Category update helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.routes.categories.access_helpers import (
    get_accessible_category_or_404,
    require_category_name_available,
    require_group_category_admin,
)
from app.schemas.category import UpdateCategoryRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def update_category_for_user(
    db: AsyncSession,
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    data: UpdateCategoryRequest,
) -> Category:
    """Update a personal or group category for a user

    Args:
        db: Active database session
        category_id: Category identifier from the route path
        user_id: Authenticated user identifier
        data: Category update payload

    Returns:
        Updated category

    Raises:
        HTTPException: Category is inaccessible, immutable, or uses a duplicate name
    """
    category = await get_accessible_category_or_404(db, category_id, user_id)

    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be modified")

    await require_group_category_admin(db, category, user_id)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return category

    if "name" in updates and updates["name"] is not None:
        await require_category_name_available(db, updates["name"], user_id, category.group_id, category.id)

    for field, value in updates.items():
        setattr(category, field, value)

    # Mark the category scope stale before committing category changes
    try:
        await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category with this name already exists",
        ) from e

    await db.refresh(category)
    return category
