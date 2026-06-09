"""Group routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.group import Group, GroupMember
from app.models.user import User
from app.routes.groups.creation_helpers import create_group_and_get_response
from app.routes.groups.deletion_helpers import delete_group_for_owner
from app.routes.groups.membership_helpers import (
    get_group_admin_membership_or_403,
    get_group_member_or_404,
    get_group_membership_or_404,
    get_group_or_404,
    get_group_owner_id,
    require_user_exists,
)
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


@router.get("", response_model=list[GroupResponse])
async def list_groups(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    exclude_archived: Annotated[bool, Query()] = False,
):
    """Return groups for the authenticated user

    Args:
        user: Authenticated user requesting groups
        db: Active database session
        exclude_archived: Whether archived groups should be omitted

    Returns:
        Groups the user belongs to, ordered by name
    """
    query = (
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
    )
    if exclude_archived:
        query = query.where(Group.is_archived.is_(False))

    # Fetch groups where the user has membership, optionally excluding archived groups
    result = await db.execute(query.order_by(Group.name))
    groups = result.scalars().all()
    return groups


@router.get("/{group_id}", response_model=GroupResponse)
async def get_group(
    group_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a group the user belongs to

    Args:
        group_id: Group identifier from the route path
        user: Authenticated user requesting the group
        db: Active database session

    Returns:
        Group visible to the user
    """
    await get_group_membership_or_404(db, group_id, user.id)
    group = await get_group_or_404(db, group_id)
    return group


@router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: uuid.UUID,
    data: UpdateGroupRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a group after checking admin access

    Args:
        group_id: Group identifier from the route path
        data: Group update payload
        user: Authenticated user updating the group
        db: Active database session

    Returns:
        Updated group
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


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a group after checking owner access

    Args:
        group_id: Group identifier from the route path
        user: Authenticated user deleting the group
        db: Active database session
    """
    await delete_group_for_owner(db, group_id, user.id)


@router.get("/{group_id}/members", response_model=list[GroupMemberResponse])
async def list_members(
    group_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return members for a group the user belongs to

    Args:
        group_id: Group identifier from the route path
        user: Authenticated user requesting members
        db: Active database session

    Returns:
        Group members
    """
    await get_group_membership_or_404(db, group_id, user.id)

    # Fetch members for the requested group after confirming the caller is a member
    result = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id),
    )
    members = result.scalars().all()
    return members


@router.post("/{group_id}/members", response_model=GroupMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    group_id: uuid.UUID,
    data: AddGroupMemberRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a non-admin member to a group after checking admin access

    Args:
        group_id: Group identifier from the route path
        data: Member addition payload
        user: Authenticated user adding the member
        db: Active database session

    Returns:
        Created group membership
    """
    await get_group_admin_membership_or_403(db, group_id, user.id)
    await require_user_exists(db, data.user_id)

    # Check whether the target user is already a member of this group
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
    """Update a member's admin status after checking owner access

    Args:
        group_id: Group identifier from the route path
        member_id: Target member user identifier
        data: Admin status update payload
        user: Authenticated user updating the member
        db: Active database session

    Returns:
        Updated group membership
    """
    await get_group_membership_or_404(db, group_id, user.id)
    owner_id = await get_group_owner_id(db, group_id)
    if user.id != owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can change admin status")

    target = await get_group_member_or_404(db, group_id, member_id)

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
    """Remove a member from a group

    Admins can remove others, any member can leave, and owners cannot be
    removed from the group

    Args:
        group_id: Group identifier from the route path
        member_id: Target member user identifier
        user: Authenticated user removing the member
        db: Active database session
    """
    caller = await get_group_membership_or_404(db, group_id, user.id)

    is_self = member_id == user.id
    if not is_self and not caller.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    owner_id = await get_group_owner_id(db, group_id)
    if member_id == owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot remove the owner")

    if is_self:
        target = caller
    else:
        target = await get_group_member_or_404(db, group_id, member_id)

    # Delete the membership after authorisation and owner protection checks pass
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
    """Create a group with the creator as owner and admin

    Args:
        data: Group creation payload
        user: Authenticated user creating the group
        db: Active database session

    Returns:
        Newly created group
    """
    return await create_group_and_get_response(db, user, data)
