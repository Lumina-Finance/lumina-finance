"""Group creation helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group, GroupMember
from app.models.user import User
from app.schemas.group import CreateGroupRequest, GroupResponse
from app.services.cache_state import mark_group_cache_changed, mark_user_cache_changed


async def create_group_and_get_response(
    db: AsyncSession,
    user: User,
    data: CreateGroupRequest,
) -> GroupResponse:
    """Create a group with the creator as owner and admin

    Args:
        db: Active database session
        user: Authenticated user creating the group
        data: Group creation payload

    Returns:
        Newly created group
    """
    group_id = uuid.uuid4()
    group = Group(id=group_id, owner_id=user.id, name=data.name, profile_pic=data.profile_pic)
    group_member = GroupMember(group_id=group_id, user_id=user.id, is_admin=True)

    # Create the owner membership with the group so owner and admin access stay in sync
    db.add(group)
    db.add(group_member)
    await mark_user_cache_changed(db, user.id)
    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(group)
    return group
