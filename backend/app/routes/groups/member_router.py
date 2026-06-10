"""Group member routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.groups.member_addition_helpers import add_group_member_and_get_membership
from app.routes.groups.member_admin_status_helpers import update_group_member_admin_status_and_get_membership
from app.routes.groups.member_listing_helpers import get_group_members_for_user
from app.routes.groups.member_removal_helpers import remove_group_member
from app.schemas.group import (
    AddGroupMemberRequest,
    GroupMemberResponse,
    UpdateGroupMemberAdminRequest,
)

router = APIRouter(prefix="/{group_id}/members", tags=["groups"])


@router.get("", response_model=list[GroupMemberResponse])
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
    members = await get_group_members_for_user(db, group_id, user.id)
    return members


@router.post("", response_model=GroupMemberResponse, status_code=status.HTTP_201_CREATED)
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
    group_member = await add_group_member_and_get_membership(db, group_id, user.id, data)
    return group_member


@router.patch("/{member_id}", response_model=GroupMemberResponse)
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
    group_member = await update_group_member_admin_status_and_get_membership(db, group_id, member_id, user.id, data)
    return group_member


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
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
    await remove_group_member(db, group_id, member_id, user.id)
