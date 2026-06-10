"""Group member addition helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import GroupMember
from app.routes.groups.membership_helpers import get_group_admin_membership_or_403, require_user_exists
from app.schemas.group import AddGroupMemberRequest
from app.services.cache_state import mark_group_cache_changed


async def add_group_member_and_get_membership(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    data: AddGroupMemberRequest,
) -> GroupMember:
    """Add a non-admin member after checking group admin access

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        user_id: Authenticated user adding the member
        data: Member addition payload

    Returns:
        Created group membership

    Raises:
        HTTPException: User is not a group admin, the target user does not exist, or the target user already belongs to the group
    """
    await get_group_admin_membership_or_403(db, group_id, user_id)
    await require_user_exists(db, data.user_id)

    # Check whether the target user already belongs to this group
    existing_membership_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == data.user_id,
    )
    existing_membership_result = await db.execute(existing_membership_query)
    if existing_membership_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member")

    group_member = GroupMember(group_id=group_id, user_id=data.user_id)
    db.add(group_member)
    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(group_member)
    return group_member
