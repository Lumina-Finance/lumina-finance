"""Group update helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.routes.groups.membership_helpers import get_group_admin_membership_or_403, get_group_or_404
from app.schemas.group import GroupResponse, UpdateGroupRequest
from app.services.cache_state import mark_group_cache_changed


async def update_group_and_get_response(
    db: AsyncSession,
    user: User,
    group_id: uuid.UUID,
    data: UpdateGroupRequest,
) -> GroupResponse:
    """Update a group after checking admin access

    Args:
        db: Active database session
        user: Authenticated user updating the group
        group_id: Group identifier from the route path
        data: Group update payload

    Returns:
        Updated group

    Raises:
        HTTPException: User is not a group member or group admin
    """
    await get_group_admin_membership_or_403(db, group_id, user.id)
    group = await get_group_or_404(db, group_id)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return group

    for field, value in changed_fields.items():
        setattr(group, field, value)

    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(group)
    return group
