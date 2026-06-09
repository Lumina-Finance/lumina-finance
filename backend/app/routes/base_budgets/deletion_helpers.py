"""Base budget deletion helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_base_budget_access
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_base_budget_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    base_budget_id: uuid.UUID,
) -> None:
    """Delete a base budget after checking admin access

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        base_budget_id: Base budget identifier from the route path

    Raises:
        HTTPException: User lacks admin access
    """
    base_budget = await check_base_budget_access(db, base_budget_id, user_id, PermissionLevel.ADMIN)
    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.delete(base_budget)
    await db.commit()
