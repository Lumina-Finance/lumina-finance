"""Base budget permission routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.base_budgets.permissions.grant_helpers import grant_base_budget_permission_to_member
from app.routes.base_budgets.permissions.listing_helpers import get_base_budget_permissions_for_admin
from app.routes.base_budgets.permissions.revoke_helpers import revoke_base_budget_permission_for_admin
from app.schemas.permission import BudgetPermissionResponse, GrantBudgetPermissionRequest

router = APIRouter()


@router.post(
    "/{base_budget_id}/permissions",
    response_model=BudgetPermissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def grant_base_budget_permission(
    base_budget_id: uuid.UUID,
    data: GrantBudgetPermissionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Grant or update a member's access level on a group base budget

    Args:
        base_budget_id: Base budget identifier from the route path
        data: Requested member and permission level
        user: Authenticated user making the change
        db: Active database session

    Returns:
        Created or updated budget permission row

    Raises:
        HTTPException: Base budget is not group-scoped, actor is not admin, or target member is invalid
    """
    permission = await grant_base_budget_permission_to_member(db, base_budget_id, user.id, data)
    return permission


@router.delete(
    "/{base_budget_id}/permissions/{permission_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_base_budget_permission(
    base_budget_id: uuid.UUID,
    permission_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Revoke a member's access to a group base budget

    Args:
        base_budget_id: Base budget identifier from the route path
        permission_id: Budget permission identifier from the route path
        user: Authenticated user making the change
        db: Active database session

    Raises:
        HTTPException: Base budget is not group-scoped, actor is not admin, or permission is missing
    """
    await revoke_base_budget_permission_for_admin(db, base_budget_id, permission_id, user.id)


@router.get(
    "/{base_budget_id}/permissions",
    response_model=list[BudgetPermissionResponse],
)
async def list_base_budget_permissions(
    base_budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: uuid.UUID | None = None,
):
    """Return permissions for a group base budget

    Args:
        base_budget_id: Base budget identifier from the route path
        user: Authenticated user requesting permissions
        db: Active database session
        user_id: Optional user filter for permission rows

    Returns:
        Budget permissions ordered by creation time

    Raises:
        HTTPException: Base budget is not group-scoped or actor is not admin
    """
    permissions = await get_base_budget_permissions_for_admin(db, base_budget_id, user.id, user_id)
    return permissions
