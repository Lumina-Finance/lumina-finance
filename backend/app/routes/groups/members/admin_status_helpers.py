"""Group member admin status helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import GroupMember
from app.routes.groups.membership_helpers import (
    get_group_member_or_404,
    get_group_membership_or_404,
    get_group_owner_id,
)
from app.schemas.group import UpdateGroupMemberAdminRequest
from app.services.cache_state import mark_group_cache_changed


async def update_group_member_admin_status_and_get_membership(
    db: AsyncSession,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user_id: uuid.UUID,
    data: UpdateGroupMemberAdminRequest,
) -> GroupMember:
    """Update a member's admin status after checking owner access

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        member_id: Target member user identifier
        user_id: Authenticated user updating the member
        data: Admin status update payload

    Returns:
        Updated group membership

    Raises:
        HTTPException: User is not a group member, is not the owner, or tries to demote the owner
    """
    await get_group_membership_or_404(db, group_id, user_id)
    owner_id = await get_group_owner_id(db, group_id)

    # Only the group owner can change admin status, including for other admins
    if user_id != owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can change admin status")

    target = await get_group_member_or_404(db, group_id, member_id)

    # Keep the owner as an admin so the group always has owner-level access
    if member_id == owner_id and not data.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot demote the owner")

    target.is_admin = data.is_admin
    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(target)
    return target
