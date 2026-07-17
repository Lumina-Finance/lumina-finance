"""Base budget utilization route helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_base_budget_access
from app.schemas.budget import BudgetUtilizationResponse
from app.services.budgets.listing import get_budgets_for_base_budget
from app.services.budgets.utilization import get_budget_utilization_responses


async def get_base_budget_utilizations_for_user(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[BudgetUtilizationResponse]:
    """Return utilization for every period of a base budget after checking read access

    Args:
        db: Active database session
        base_budget_id: Base budget identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Budget utilization responses ordered by period start ascending

    Raises:
        HTTPException: User does not have read access
    """
    base_budget = await check_base_budget_access(db, base_budget_id, user_id, PermissionLevel.READ)
    budgets = await get_budgets_for_base_budget(db, base_budget_id)
    budget_rows = [(budget, base_budget) for budget in budgets]
    return await get_budget_utilization_responses(db, budget_rows)
