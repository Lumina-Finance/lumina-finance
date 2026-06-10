"""Category creation helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.routes.categories.access_helpers import (
    is_valid_category_kind,
    require_category_name_available,
    require_group_member,
)
from app.schemas.category import CreateCategoryRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def create_category_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: CreateCategoryRequest,
) -> Category:
    """Create a personal or group category for a user

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        data: Category creation payload

    Returns:
        Newly created category

    Raises:
        HTTPException: Category kind is invalid, group is inaccessible, or category name already exists
    """
    if not is_valid_category_kind(data.kind):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid category kind")

    group_id = data.group_id
    if group_id is not None:
        await require_group_member(db, group_id, user_id)

    await require_category_name_available(db, data.name, user_id, group_id)

    category = Category(
        owner_id=None if group_id else user_id,
        group_id=group_id,
        name=data.name,
        kind=data.kind,
        icon=data.icon,
    )
    db.add(category)

    # Mark the category scope stale before committing the newly created category
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
