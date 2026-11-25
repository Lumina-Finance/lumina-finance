"""Budget deletion route helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_budget_access
from app.services.allowance.currency import require_writable_record
from app.services.budgets.deletion import delete_budget_instance


async def delete_budget_for_user(
    db: AsyncSession,
    budget_id: uuid.UUID,
    user: User,
) -> None:
    """Delete a budget instance after checking admin access

    A period is part of its budget's history, so a read-only budget keeps every period. The budget
    itself can still be deleted or archived

    Args:
        db: Active database session
        budget_id: Budget instance identifier from the route path
        user: Authenticated user deleting the budget instance

    Raises:
        HTTPException: User does not have admin access, or the budget's currency keeps it read-only
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)
    await require_writable_record(db, user, base_budget)
    await delete_budget_instance(db, budget, base_budget)
