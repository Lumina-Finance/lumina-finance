"""Tag creation helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
from app.routes.tags.access_helpers import require_group_member, require_tag_name_available
from app.schemas.tag import CreateTagRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def create_tag_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: CreateTagRequest,
) -> Tag:
    """Create a personal or group tag for a user

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        data: Tag creation payload

    Returns:
        Newly created tag

    Raises:
        HTTPException: Group is inaccessible or tag name already exists
    """
    group_id = data.group_id
    if group_id is not None:
        await require_group_member(db, group_id, user_id)

    await require_tag_name_available(db, data.name, user_id, group_id)

    tag = Tag(owner_id=user_id, group_id=group_id, name=data.name)
    db.add(tag)

    # Mark the tag scope stale before committing the newly created tag
    await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
    await db.commit()
    await db.refresh(tag)
    return tag
