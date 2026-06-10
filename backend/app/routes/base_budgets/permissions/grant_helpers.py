"""Base budget permission grant helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, BudgetPermission
from app.models.group import GroupMember
from app.routes.base_budgets.permissions.access_helpers import (
    get_base_budget_admin_membership_or_403,
    get_group_base_budget_or_404,
)
from app.schemas.permission import GrantBudgetPermissionRequest
from app.services.cache_state import mark_group_cache_changed


async def grant_base_budget_permission_to_member(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    user_id: uuid.UUID,
    data: GrantBudgetPermissionRequest,
) -> BudgetPermission:
    """Grant or update a member's access level on a group base budget

    Args:
        db: Active database session
        base_budget_id: Base budget identifier from the route path
        user_id: Authenticated user making the change
        data: Requested member and permission level

    Returns:
        Created or updated budget permission row

    Raises:
        HTTPException: Base budget is not group-scoped, actor is not admin, or target member is invalid
    """
    base_budget = await get_group_base_budget_or_404(db, base_budget_id)
    await get_base_budget_admin_membership_or_403(db, base_budget.group_id, user_id)
    await _get_non_admin_group_member_or_422(db, base_budget.group_id, data.user_id)

    existing_permission = await _get_existing_base_budget_permission(db, base_budget, data.user_id)
    if existing_permission:
        existing_permission.level = data.level
        await mark_group_cache_changed(db, base_budget.group_id)
        await db.commit()
        await db.refresh(existing_permission)
        return existing_permission

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


async def _get_non_admin_group_member_or_422(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return a target member who can receive explicit base budget access

    Args:
        db: Active database session
        group_id: Group identifier for the base budget
        user_id: Target member user identifier

    Returns:
        Target group membership row

    Raises:
        HTTPException: Target user is not a group member or already has implicit admin access
    """
    target_member_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Confirm the target user belongs to the base budget group before granting explicit access
    result = await db.execute(target_member_query)
    target_member = result.scalar_one_or_none()
    if not target_member:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User is not a member of this group")
    if target_member.is_admin:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Admins have implicit full access")
    return target_member


async def _get_existing_base_budget_permission(
    db: AsyncSession,
    base_budget: BaseBudget,
    user_id: uuid.UUID,
) -> BudgetPermission | None:
    """Return an existing base budget permission for a target member

    Args:
        db: Active database session
        base_budget: Group-scoped base budget receiving the permission
        user_id: Target member user identifier

    Returns:
        Existing budget permission row when one exists
    """
    permission_query = select(BudgetPermission).where(
        BudgetPermission.group_id == base_budget.group_id,
        BudgetPermission.user_id == user_id,
        BudgetPermission.base_budget_id == base_budget.id,
    )

    # Look for an existing permission so repeated grants update the access level instead of duplicating rows
    result = await db.execute(permission_query)
    budget_permission = result.scalar_one_or_none()
    return budget_permission
