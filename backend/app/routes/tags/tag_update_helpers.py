"""Tag update helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
from app.routes.tags.access_helpers import get_accessible_tag_or_404, require_group_tag_admin
from app.schemas.tag import UpdateTagRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def update_tag_for_user(
    db: AsyncSession,
    tag_id: uuid.UUID,
    user_id: uuid.UUID,
    data: UpdateTagRequest,
) -> Tag:
    """Update a personal or group tag for a user

    Args:
        db: Active database session
        tag_id: Tag identifier from the route path
        user_id: Authenticated user identifier
        data: Tag update payload

    Returns:
        Updated tag

    Raises:
        HTTPException: Tag is inaccessible, group admin access is missing, or tag name already exists
    """
    tag = await get_accessible_tag_or_404(db, tag_id, user_id)
    await require_group_tag_admin(db, tag, user_id)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return tag

    for field, value in updates.items():
        setattr(tag, field, value)

    # Mark the tag scope stale before committing tag changes
    try:
        await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tag with this name already exists",
        ) from e

    await db.refresh(tag)
    return tag
