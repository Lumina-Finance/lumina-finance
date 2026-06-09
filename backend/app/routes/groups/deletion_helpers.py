"""Group deletion helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import GroupMember
from app.routes.groups.membership_helpers import get_group_membership_or_404, get_group_or_404
from app.services.cache_state import mark_user_cache_changed


async def delete_group_for_owner(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete a group after checking owner access

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User is not a group member or group owner
    """
    await get_group_membership_or_404(db, group_id, user_id)
    group = await get_group_or_404(db, group_id)

    if group.owner_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this group")

    member_id_query = select(GroupMember.user_id).where(GroupMember.group_id == group_id)

    # Fetch current member IDs so each member's personal cache is invalidated before group deletion
    member_result = await db.execute(member_id_query)
    member_ids = member_result.scalars().all()
    for member_user_id in member_ids:
        await mark_user_cache_changed(db, member_user_id)

    # Delete the group after member cache invalidations are recorded
    await db.delete(group)
    await db.commit()
