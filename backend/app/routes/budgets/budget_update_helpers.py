"""Budget update route helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_budget_access
from app.schemas.budget import BudgetResponse, UpdateBudgetRequest
from app.services.budgets.updates import update_budget_instance


async def update_budget_for_user(
    db: AsyncSession,
    budget_id: uuid.UUID,
    user_id: uuid.UUID,
    data: UpdateBudgetRequest,
) -> BudgetResponse:
    """Update a budget instance after checking admin access

    Args:
        db: Active database session
        budget_id: Budget instance identifier from the route path
        user_id: Authenticated user identifier
        data: Budget instance fields to update

    Returns:
        Updated budget instance response

    Raises:
        HTTPException: User does not have admin access or update fields are invalid
    """
    budget, base_budget = await check_budget_access(db, budget_id, user_id, PermissionLevel.ADMIN)
    updates = data.model_dump(exclude_unset=True)
    response = await update_budget_instance(db, budget, base_budget, updates)
    return response
