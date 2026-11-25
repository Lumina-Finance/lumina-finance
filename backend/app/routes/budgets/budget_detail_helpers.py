"""Budget detail route helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_budget_access
from app.schemas.budget import BudgetResponse
from app.services.budgets.response_helpers import get_budget_response


async def get_budget_response_for_user(
    db: AsyncSession,
    budget_id: uuid.UUID,
    user: User,
) -> BudgetResponse:
    """Return a budget instance response after checking read access

    Args:
        db: Active database session
        budget_id: Budget instance identifier from the route path
        user: Authenticated user requesting the budget instance

    Returns:
        Budget instance response

    Raises:
        HTTPException: User does not have read access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    response = await get_budget_response(db, user, budget, base_budget)
    return response
