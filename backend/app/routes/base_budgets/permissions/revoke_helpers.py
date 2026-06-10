"""Base budget permission revoke helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BudgetPermission
from app.routes.base_budgets.permissions.access_helpers import (
    get_base_budget_admin_membership_or_403,
    get_group_base_budget_or_404,
)
from app.services.cache_state import mark_group_cache_changed


async def revoke_base_budget_permission_for_admin(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    permission_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Revoke a member's access to a group base budget after checking admin access

    Args:
        db: Active database session
        base_budget_id: Base budget identifier from the route path
        permission_id: Budget permission identifier from the route path
        user_id: Authenticated user making the change

    Raises:
        HTTPException: Base budget is not group-scoped, actor is not admin, or permission is missing
    """
    base_budget = await get_group_base_budget_or_404(db, base_budget_id)
    await get_base_budget_admin_membership_or_403(db, base_budget.group_id, user_id)
    budget_permission = await _get_base_budget_permission_or_404(db, base_budget_id, permission_id)

    await db.delete(budget_permission)
    await mark_group_cache_changed(db, base_budget.group_id)
    await db.commit()


async def _get_base_budget_permission_or_404(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    permission_id: uuid.UUID,
) -> BudgetPermission:
    """Return a permission row within a base budget or raise not found

    Args:
        db: Active database session
        base_budget_id: Base budget identifier from the route path
        permission_id: Budget permission identifier from the route path

    Returns:
        Budget permission row

    Raises:
        HTTPException: Permission does not exist within the base budget
    """
    permission_query = select(BudgetPermission).where(
        BudgetPermission.id == permission_id,
        BudgetPermission.base_budget_id == base_budget_id,
    )

    # Fetch the permission row within the base budget so revocation cannot cross budget boundaries
    result = await db.execute(permission_query)
    budget_permission = result.scalar_one_or_none()
    if not budget_permission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")
    return budget_permission
