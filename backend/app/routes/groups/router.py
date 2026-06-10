"""Group routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.groups.creation_helpers import create_group_and_get_response
from app.routes.groups.deletion_helpers import delete_group_for_owner
from app.routes.groups.group_detail_helpers import get_group_for_user
from app.routes.groups.listing_helpers import get_groups_for_user
from app.routes.groups.members import router as member_router
from app.routes.groups.update_helpers import update_group_and_get_response
from app.schemas.group import (
    CreateGroupRequest,
    GroupResponse,
    UpdateGroupRequest,
)

router = APIRouter(prefix="/groups", tags=["groups"])
router.include_router(member_router)


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
    groups = await get_groups_for_user(db, user.id, exclude_archived)
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
    group = await get_group_for_user(db, group_id, user.id)
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
    return await update_group_and_get_response(db, user, group_id, data)


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
