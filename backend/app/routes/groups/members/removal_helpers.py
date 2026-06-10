"""Group member removal helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.groups.membership_helpers import (
    get_group_member_or_404,
    get_group_membership_or_404,
    get_group_owner_id,
)
from app.services.cache_state import mark_group_cache_changed, mark_user_cache_changed


async def remove_group_member(
    db: AsyncSession,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Remove a group member after checking member removal rules

    Admins can remove others, any member can leave, and owners cannot be
    removed from the group

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        member_id: Target member user identifier
        user_id: Authenticated user removing the member

    Raises:
        HTTPException: User is not a member, cannot remove others, or tries to remove the owner
    """
    caller_membership = await get_group_membership_or_404(db, group_id, user_id)

    # Allow members to remove themselves, but require admin access to remove others
    is_self_removal = member_id == user_id
    if not is_self_removal and not caller_membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    owner_id = await get_group_owner_id(db, group_id)

    # Keep the owner in the group so owner-level access cannot be removed
    if member_id == owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot remove the owner")

    if is_self_removal:
        target_membership = caller_membership
    else:
        target_membership = await get_group_member_or_404(db, group_id, member_id)

    await db.delete(target_membership)
    await mark_group_cache_changed(db, group_id)
    await mark_user_cache_changed(db, member_id)
    await db.commit()
