import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.group import Group, GroupMember
from app.models.user import User
from app.schemas.group import (
    AddGroupMemberRequest,
    CreateGroupRequest,
    GroupMemberResponse,
    GroupResponse,
    UpdateGroupMemberAdminRequest,
    UpdateGroupRequest,
)
from app.services.cache_state import mark_group_cache_changed, mark_user_cache_changed

router = APIRouter(prefix="/groups", tags=["groups"])


async def _check_membership_or_404(
    db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID,
) -> GroupMember:
    """Return the user's membership or raise 404 if they are not a member.

    Args:
        db: Async database session.
        group_id: UUID of the group.
        user_id: UUID of the user.

    Returns:
        The GroupMember row.

    Raises:
        HTTPException 404: User is not a member of the group.
    """
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return membership


async def _check_admin_or_403(
    db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID,
) -> GroupMember:
    """Return the user's membership or raise 403 if they are not an admin.

    Args:
        db: Async database session.
        group_id: UUID of the group.
        user_id: UUID of the user.

    Returns:
        The GroupMember row.

    Raises:
        HTTPException 404: User is not a member of the group.
        HTTPException 403: User is a member but not an admin.
    """
    membership = await _check_membership_or_404(db, group_id, user_id)
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership


@router.get("", response_model=list[GroupResponse])
async def list_groups(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    exclude_archived: Annotated[bool, Query()] = False,
):
    """Return all groups the authenticated user is a member of."""
    query = (
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
    )
    if exclude_archived:
        query = query.where(Group.is_archived.is_(False))
    result = await db.execute(query.order_by(Group.name))
    return result.scalars().all()


@router.get("/{group_id}", response_model=GroupResponse)
async def get_group(
    group_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single group. User must be a member."""
    await _check_membership_or_404(db, group_id, user.id)
    result = await db.execute(
        select(Group).where(Group.id == group_id),
    )
    return result.scalar_one()


@router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: uuid.UUID,
    data: UpdateGroupRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a group. Only admins can update."""
    await _check_admin_or_403(db, group_id, user.id)

    result = await db.execute(
        select(Group).where(Group.id == group_id),
    )
    group = result.scalar_one()

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return group

    for field, value in changed_fields.items():
        setattr(group, field, value)

    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a group. Only the owner can delete."""
    await _check_membership_or_404(db, group_id, user.id)

    result = await db.execute(
        select(Group).where(Group.id == group_id),
    )
    group = result.scalar_one()

    if group.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this group")

    member_ids = (await db.execute(select(GroupMember.user_id).where(GroupMember.group_id == group_id))).scalars().all()
    for member_user_id in member_ids:
        await mark_user_cache_changed(db, member_user_id)
    await db.delete(group)
    await db.commit()


@router.get("/{group_id}/members", response_model=list[GroupMemberResponse])
async def list_members(
    group_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List all members of a group. User must be a member."""
    await _check_membership_or_404(db, group_id, user.id)
    result = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id),
    )
    return result.scalars().all()


@router.post("/{group_id}/members", response_model=GroupMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    group_id: uuid.UUID,
    data: AddGroupMemberRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a user to a group. Only admins can add members. New members join as non-admin."""
    await _check_admin_or_403(db, group_id, user.id)

    # Verify target user exists (generic message to avoid leaking user existence)
    target_user = await db.execute(
        select(User).where(User.id == data.user_id),
    )
    if not target_user.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid user")

    # Check if already a member
    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == data.user_id,
        ),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member")

    group_member = GroupMember(group_id=group_id, user_id=data.user_id)
    db.add(group_member)
    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(group_member)
    return group_member


@router.patch("/{group_id}/members/{member_id}", response_model=GroupMemberResponse)
async def update_member_admin(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    data: UpdateGroupMemberAdminRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Promote or demote a member. Only the group owner can change admin status."""
    await _check_membership_or_404(db, group_id, user.id)

    # Only the owner can promote/demote admins
    result = await db.execute(
        select(Group.owner_id).where(Group.id == group_id),
    )
    owner_id = result.scalar_one()
    if user.id != owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can change admin status")

    target_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == member_id,
        ),
    )
    target = target_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    # Owner cannot be demoted
    if member_id == owner_id and not data.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot demote the owner")

    target.is_admin = data.is_admin
    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{group_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove a member from a group. Admins can remove others; any member can leave.

    The owner cannot be removed — they must delete the group instead.
    """
    caller = await _check_membership_or_404(db, group_id, user.id)

    # Any member can self-leave, but only admins can remove others
    is_self = member_id == user.id
    if not is_self and not caller.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    # Prevent removing the owner
    result = await db.execute(
        select(Group.owner_id).where(Group.id == group_id),
    )
    if member_id == result.scalar_one():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot remove the owner")

    if is_self:
        target = caller
    else:
        target_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == member_id,
            ),
        )
        target = target_result.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    await db.delete(target)
    await mark_group_cache_changed(db, group_id)
    await mark_user_cache_changed(db, member_id)
    await db.commit()


@router.post("", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    data: CreateGroupRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new group. The creator becomes the owner and is auto-added as admin."""
    group_id = uuid.uuid4()
    group = Group(id=group_id, owner_id=user.id, name=data.name, profile_pic=data.profile_pic)
    group_member = GroupMember(group_id=group_id, user_id=user.id, is_admin=True)
    db.add(group)
    db.add(group_member)
    await mark_user_cache_changed(db, user.id)
    await mark_group_cache_changed(db, group_id)
    await db.commit()
    await db.refresh(group)
    return group
