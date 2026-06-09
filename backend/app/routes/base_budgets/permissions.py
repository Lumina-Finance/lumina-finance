"""Base budget permission route handlers"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.budget import BaseBudget, BudgetPermission
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.permission import BudgetPermissionResponse, GrantBudgetPermissionRequest
from app.services.cache_state import mark_group_cache_changed

router = APIRouter()


async def _get_group_base_budget_or_404(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
) -> BaseBudget:
    """Return a group base budget or raise a not-found response

    Personal base budgets also return 404 so unauthorized callers cannot
    distinguish between missing and personal base budgets

    Args:
        db: Active database session
        base_budget_id: Base budget identifier from the route path

    Returns:
        Group-scoped base budget row

    Raises:
        HTTPException: Base budget is missing or personal
    """
    result = await db.execute(select(BaseBudget).where(BaseBudget.id == base_budget_id))
    base_budget = result.scalar_one_or_none()
    if not base_budget or not base_budget.group_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Base budget not found")
    return base_budget


async def _get_base_budget_admin_membership_or_403(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return group membership when the user can manage base budget permissions

    Args:
        db: Active database session
        group_id: Group identifier for the base budget
        user_id: Authenticated user identifier

    Returns:
        Group membership for an admin user

    Raises:
        HTTPException: User is not a member or is not an admin
    """
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Base budget not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership


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
    base_budget = await _get_group_base_budget_or_404(db, base_budget_id)
    await _get_base_budget_admin_membership_or_403(db, base_budget.group_id, user.id)

    target_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == base_budget.group_id,
            GroupMember.user_id == data.user_id,
        ),
    )
    target_member = target_result.scalar_one_or_none()
    if not target_member:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User is not a member of this group")
    if target_member.is_admin:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Admins have implicit full access")

    existing_result = await db.execute(
        select(BudgetPermission).where(
            BudgetPermission.group_id == base_budget.group_id,
            BudgetPermission.user_id == data.user_id,
            BudgetPermission.base_budget_id == base_budget_id,
        ),
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        existing.level = data.level
        await mark_group_cache_changed(db, base_budget.group_id)
        await db.commit()
        await db.refresh(existing)
        return existing

    budget_permission = BudgetPermission(
        group_id=base_budget.group_id,
        user_id=data.user_id,
        base_budget_id=base_budget_id,
        level=data.level,
    )
    db.add(budget_permission)
    await mark_group_cache_changed(db, base_budget.group_id)
    await db.commit()
    await db.refresh(budget_permission)
    return budget_permission


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
    base_budget = await _get_group_base_budget_or_404(db, base_budget_id)
    await _get_base_budget_admin_membership_or_403(db, base_budget.group_id, user.id)

    result = await db.execute(
        select(BudgetPermission).where(
            BudgetPermission.id == permission_id,
            BudgetPermission.base_budget_id == base_budget_id,
        ),
    )
    budget_permission = result.scalar_one_or_none()
    if not budget_permission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")

    await db.delete(budget_permission)
    await mark_group_cache_changed(db, base_budget.group_id)
    await db.commit()


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
    base_budget = await _get_group_base_budget_or_404(db, base_budget_id)
    await _get_base_budget_admin_membership_or_403(db, base_budget.group_id, user.id)

    query = select(BudgetPermission).where(BudgetPermission.base_budget_id == base_budget_id)
    if user_id:
        query = query.where(BudgetPermission.user_id == user_id)

    result = await db.execute(query.order_by(BudgetPermission.created_at))
    return result.scalars().all()
