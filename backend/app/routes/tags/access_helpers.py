"""Tag access route helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import GroupMember
from app.models.tag import Tag
from app.routes.tags.tag_scope_filter_helpers import get_accessible_tag_filter


async def get_accessible_tag_or_404(db: AsyncSession, tag_id: uuid.UUID, user_id: uuid.UUID) -> Tag:
    """Return a tag visible to the user or raise not found

    Args:
        db: Active database session
        tag_id: Tag identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Tag visible to the user

    Raises:
        HTTPException: Tag is missing or not visible to the user
    """
    tag_filter = get_accessible_tag_filter(user_id)

    # Fetch the tag only when it is visible to the requesting user
    result = await db.execute(
        select(Tag).where(
            Tag.id == tag_id,
            tag_filter,
        ),
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return tag


async def require_group_member(db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Raise not found when a user is not a group member

    Args:
        db: Active database session
        group_id: Group identifier from the request
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User is not a member of the group
    """
    membership_filter = (
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch group membership so group-scoped tag operations reject outsiders
    member_result = await db.execute(
        select(GroupMember).where(*membership_filter),
    )
    is_group_member = member_result.scalar_one_or_none() is not None
    if not is_group_member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")


async def require_group_tag_admin(db: AsyncSession, tag: Tag, user_id: uuid.UUID) -> None:
    """Raise forbidden when a group tag change is not made by an admin

    Personal tags do not require group admin checks

    Args:
        db: Active database session
        tag: Tag being changed
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User is not an admin for the tag's group
    """
    if tag.group_id is None:
        return

    # Fetch group membership so group-scoped tag changes require an admin
    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == tag.group_id,
            GroupMember.user_id == user_id,
        ),
    )
    member = member_result.scalar_one_or_none()
    if not member or not member.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


async def require_tag_name_available(
    db: AsyncSession,
    name: str,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
) -> None:
    """Raise a conflict response when a tag name is already used

    Args:
        db: Active database session
        name: Requested tag name
        user_id: User identifier for personal tag scope
        group_id: Optional group identifier for group tag scope

    Raises:
        HTTPException: Tag name already exists in the target scope
    """
    duplicate_query = select(Tag).where(Tag.name == name)
    if group_id:
        duplicate_query = duplicate_query.where(Tag.group_id == group_id)
    else:
        duplicate_query = duplicate_query.where(Tag.owner_id == user_id, Tag.group_id.is_(None))

    # Check whether the target scope already has a tag with the requested name
    has_duplicate = (await db.execute(duplicate_query)).scalar_one_or_none() is not None
    if has_duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag with this name already exists")
