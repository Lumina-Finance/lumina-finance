"""Category listing helpers"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.routes.categories.access_helpers import get_system_or_personal_category_filter, require_group_member


async def get_categories_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
) -> Sequence[Category]:
    """Return categories visible in the requested scope

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        group_id: Optional group scope to include with system and personal categories

    Returns:
        Categories ordered by name

    Raises:
        HTTPException: User is not a member of the requested group
    """
    category_filter = get_system_or_personal_category_filter(user_id)
    if group_id is not None:
        await require_group_member(db, group_id, user_id)
        category_filter = category_filter | (Category.group_id == group_id)

    category_query = select(Category).where(category_filter).order_by(Category.name)

    # Fetch visible categories for the requested personal or group scope
    result = await db.execute(category_query)
    categories = result.scalars().all()
    return categories
