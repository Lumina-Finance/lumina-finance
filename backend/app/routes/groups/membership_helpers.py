"""Group membership route helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group, GroupMember
from app.models.user import User


async def get_group_membership_or_404(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return the user's group membership or raise not found

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        user_id: User identifier to look up

    Returns:
        Group membership row for the user

    Raises:
        HTTPException: User is not a member of the group
    """
    membership_filter = (
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the user's membership so non-members see the group as not found
    result = await db.execute(select(GroupMember).where(*membership_filter))
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return membership


async def get_group_admin_membership_or_403(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return the user's group membership when they are an admin

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Admin group membership row for the user

    Raises:
        HTTPException: User is not a member or is not an admin
    """
    membership = await get_group_membership_or_404(db, group_id, user_id)
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership


async def get_group_or_404(db: AsyncSession, group_id: uuid.UUID) -> Group:
    """Return a group by identifier or raise not found

    Args:
        db: Active database session
        group_id: Group identifier from the route path

    Returns:
        Group row

    Raises:
        HTTPException: Group does not exist
    """
    group_filter = Group.id == group_id

    # Fetch the group row after membership checks confirm the caller may see it
    result = await db.execute(select(Group).where(group_filter))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


async def get_group_owner_id(db: AsyncSession, group_id: uuid.UUID) -> uuid.UUID:
    """Return the owner user identifier for a group

    Args:
        db: Active database session
        group_id: Group identifier from the route path

    Returns:
        User identifier for the group owner
    """
    group_filter = Group.id == group_id

    # Fetch the group owner so owner-only member and group changes can be enforced
    result = await db.execute(select(Group.owner_id).where(group_filter))
    owner_id = result.scalar_one()
    return owner_id


async def get_group_member_or_404(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return a group member or raise not found

    Args:
        db: Active database session
        group_id: Group identifier from the route path
        user_id: Target member user identifier

    Returns:
        Group membership row for the target member

    Raises:
        HTTPException: Target user is not a member of the group
    """
    membership_filter = (
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the target membership inside the group so member operations cannot cross group boundaries
    target_result = await db.execute(select(GroupMember).where(*membership_filter))
    target = target_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return target


async def require_user_exists(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Raise an invalid-user response when a user does not exist

    Args:
        db: Active database session
        user_id: User identifier from the request payload

    Raises:
        HTTPException: User identifier does not match an existing user
    """
    user_filter = User.id == user_id

    # Fetch the target user before adding membership while keeping a generic invalid-user response
    target_user = await db.execute(select(User).where(user_filter))
    if not target_user.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid user")
