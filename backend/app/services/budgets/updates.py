"""Budget update services"""
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget
from app.schemas.budget import BudgetResponse
from app.services.budget_responses import get_budget_response
from app.services.cache_state import mark_cache_changed_for_scope


async def update_budget_instance(
    db: AsyncSession,
    budget: Budget,
    base_budget: BaseBudget,
    updates: dict[str, Any],
) -> BudgetResponse:
    """Update mutable fields on a budget instance

    Args:
        db: Active database session
        budget: Budget instance row to update
        base_budget: Parent base budget row used for cache scope and response building
        updates: Fields present in the PATCH request body

    Returns:
        Updated budget instance response

    Raises:
        HTTPException: Update fields are invalid
    """
    if not updates:
        return await get_budget_response(db, budget, base_budget)

    # Reject explicit null because overall_limit is non-nullable on the model
    if "overall_limit" in updates and updates["overall_limit"] is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cannot set to null: overall_limit",
        )

    for field, value in updates.items():
        setattr(budget, field, value)

    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(budget)
    return await get_budget_response(db, budget, base_budget)
