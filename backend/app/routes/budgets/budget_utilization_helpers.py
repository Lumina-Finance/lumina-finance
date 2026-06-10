"""Budget utilization route helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_budget_access
from app.schemas.budget import BudgetUtilizationResponse
from app.services.budgets.utilization import get_budget_utilization_responses


async def get_budget_utilization_for_user(
    db: AsyncSession,
    budget_id: uuid.UUID,
    user_id: uuid.UUID,
) -> BudgetUtilizationResponse:
    """Return budget utilization after checking read access

    Args:
        db: Active database session
        budget_id: Budget instance identifier from the route path
        user_id: Authenticated user identifier

    Returns:
        Budget utilization response

    Raises:
        HTTPException: User does not have read access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user_id, PermissionLevel.READ)
    responses = await get_budget_utilization_responses(db, [(budget, base_budget)])
    utilization = responses[0]
    return utilization
