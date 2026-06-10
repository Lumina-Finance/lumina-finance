"""Group detail helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group
from app.routes.groups.membership_helpers import get_group_membership_or_404, get_group_or_404


async def get_group_for_user(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Group:
    """Return a group after checking the user belongs to it

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Group visible to the user

    Raises:
        HTTPException: User is not a group member or the group does not exist
    """
    await get_group_membership_or_404(db, group_id, user_id)
    group = await get_group_or_404(db, group_id)
    return group
