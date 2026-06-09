"""Group member listing helpers"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import GroupMember
from app.routes.groups.membership_helpers import get_group_membership_or_404


async def get_group_members_for_user(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[GroupMember]:
    """Return group members after checking user membership

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Group members visible to the user

    Raises:
        HTTPException: User is not a group member
    """
    await get_group_membership_or_404(db, group_id, user_id)

    # Fetch members for the requested group after confirming the caller belongs to it
    group_members_query = select(GroupMember).where(GroupMember.group_id == group_id)
    result = await db.execute(group_members_query)
    group_members = result.scalars().all()
    return group_members
