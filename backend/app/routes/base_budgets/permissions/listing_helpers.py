"""Base budget permission listing helpers"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BudgetPermission
from app.routes.base_budgets.permissions.access_helpers import (
    get_base_budget_admin_membership_or_403,
    get_group_base_budget_or_404,
)


async def get_base_budget_permissions_for_admin(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    user_id: uuid.UUID,
    filtered_user_id: uuid.UUID | None = None,
) -> list[BudgetPermission]:
    """Return permissions for a group base budget after checking admin access

    Args:
        db: Active database session
        base_budget_id: Base budget identifier from the route path
        user_id: Authenticated user requesting permissions
        filtered_user_id: Optional user filter for permission rows

    Returns:
        Budget permissions ordered by creation time

    Raises:
        HTTPException: Base budget is not group-scoped or actor is not admin
    """
    base_budget = await get_group_base_budget_or_404(db, base_budget_id)
    await get_base_budget_admin_membership_or_403(db, base_budget.group_id, user_id)

    permissions_query = select(BudgetPermission).where(BudgetPermission.base_budget_id == base_budget_id)
    if filtered_user_id:
        permissions_query = permissions_query.where(BudgetPermission.user_id == filtered_user_id)

    # Fetch permission rows for the group base budget, optionally narrowed to one member
    result = await db.execute(permissions_query.order_by(BudgetPermission.created_at))
    permissions = result.scalars().all()
    return permissions
