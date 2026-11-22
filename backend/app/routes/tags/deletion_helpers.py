"""Tag deletion helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.tags.access_helpers import get_accessible_tag_or_404, require_group_tag_admin
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.import_rules.references import refuse_tag_used_by_rule


async def delete_tag_for_user(
    db: AsyncSession,
    tag_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete a personal or group tag for a user

    Args:
        db: Active database session
        tag_id: Tag identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: Tag is inaccessible, admin access is missing, or tag is used by an import rule or referenced by transactions
    """
    tag = await get_accessible_tag_or_404(db, tag_id, user_id)
    await require_group_tag_admin(db, tag, user_id)

    # A rule adding the tag is refused first, so its name shows even when transactions use the tag too
    await refuse_tag_used_by_rule(db, tag.id)

    # Delete the tag and let the database reject existing transaction references
    await db.delete(tag)

    # Surface tag reference conflicts as a domain response instead of a raw integrity error
    try:
        await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tag is referenced by existing transactions",
        ) from e
