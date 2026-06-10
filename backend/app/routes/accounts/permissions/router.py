"""Account permission routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.accounts.permissions.grant_helpers import grant_account_permission_to_member
from app.routes.accounts.permissions.listing_helpers import get_account_permissions_for_admin
from app.routes.accounts.permissions.revoke_helpers import revoke_account_permission_for_admin
from app.schemas.permission import AccountPermissionResponse, GrantAccountPermissionRequest

router = APIRouter()


@router.post("/{account_id}/permissions", response_model=AccountPermissionResponse, status_code=status.HTTP_201_CREATED)
async def grant_account_permission(
    account_id: uuid.UUID,
    data: GrantAccountPermissionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Grant or update a member's access level on a group account

    Args:
        account_id: Account identifier from the route path
        data: Requested member and permission level
        user: Authenticated user making the change
        db: Active database session

    Returns:
        Created or updated account permission row

    Raises:
        HTTPException: Account is not group-scoped, actor is not admin, or target member is invalid
    """
    permission = await grant_account_permission_to_member(db, account_id, user.id, data)
    return permission


@router.delete("/{account_id}/permissions/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_account_permission(
    account_id: uuid.UUID,
    permission_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Revoke a member's access to a group account

    Args:
        account_id: Account identifier from the route path
        permission_id: Permission identifier from the route path
        user: Authenticated user making the change
        db: Active database session

    Raises:
        HTTPException: Account is not group-scoped, actor is not admin, or permission is missing
    """
    await revoke_account_permission_for_admin(db, account_id, permission_id, user.id)


@router.get("/{account_id}/permissions", response_model=list[AccountPermissionResponse])
async def list_account_permissions(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: uuid.UUID | None = None,
):
    """List permissions for a group account

    Args:
        account_id: Account identifier from the route path
        user: Authenticated user making the request
        db: Active database session
        user_id: Optional user filter for permission rows

    Returns:
        Account permission rows ordered by creation time

    Raises:
        HTTPException: Account is not group-scoped or actor is not admin
    """
    permissions = await get_account_permissions_for_admin(db, account_id, user.id, user_id)
    return permissions
