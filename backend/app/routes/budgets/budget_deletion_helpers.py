"""Budget deletion route helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_budget_access
from app.services.budgets.deletion import delete_budget_instance


async def delete_budget_for_user(
    db: AsyncSession,
    budget_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete a budget instance after checking admin access

    Args:
        db: Active database session
        budget_id: Budget instance identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User does not have admin access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user_id, PermissionLevel.ADMIN)
    await delete_budget_instance(db, budget, base_budget)
