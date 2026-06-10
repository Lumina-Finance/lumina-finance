"""Category deletion helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.categories.access_helpers import get_accessible_category_or_404, require_group_category_admin
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_category_for_user(
    db: AsyncSession,
    category_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete a personal or group category for a user

    System categories are immutable, and group categories require admin access

    Args:
        db: Active database session
        category_id: Category identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: Category is inaccessible, immutable, or referenced by transactions
    """
    category = await get_accessible_category_or_404(db, category_id, user_id)

    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be deleted")

    await require_group_category_admin(db, category, user_id)

    # Delete the category and let the database reject existing transaction references
    await db.delete(category)

    # Surface category reference conflicts as a domain response instead of a raw integrity error
    try:
        await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category is referenced by existing transactions",
        ) from e
