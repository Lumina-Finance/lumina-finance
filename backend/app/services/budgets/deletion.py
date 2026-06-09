"""Budget deletion services"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_budget_instance(db: AsyncSession, budget: Budget, base_budget: BaseBudget) -> None:
    """Delete a budget instance

    Args:
        db: Active database session
        budget: Budget instance row to delete
        base_budget: Parent base budget row used for cache scope
    """
    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.delete(budget)
    await db.commit()
