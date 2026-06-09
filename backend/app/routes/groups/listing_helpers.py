"""Group listing helpers"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group, GroupMember


async def get_groups_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    exclude_archived: bool,
) -> list[Group]:
    """Return groups for a user ordered by name

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        exclude_archived: Whether archived groups should be omitted

    Returns:
        Groups the user belongs to, ordered by name
    """
    group_query = (
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user_id)
    )
    if exclude_archived:
        group_query = group_query.where(Group.is_archived.is_(False))

    # Fetch groups where the user has membership, optionally excluding archived groups
    result = await db.execute(group_query.order_by(Group.name))
    groups = result.scalars().all()
    return groups
