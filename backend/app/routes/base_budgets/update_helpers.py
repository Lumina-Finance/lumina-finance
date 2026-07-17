"""Base budget update helpers"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_base_budget_access
from app.routes.base_budgets.category_helpers import update_tracked_category_links
from app.routes.base_budgets.instance_helpers import resume_budget_generation_at_current_period
from app.routes.base_budgets.response_helpers import get_base_budget_response
from app.schemas.budget import BaseBudgetResponse, UpdateBaseBudgetRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def update_base_budget_and_get_response(
    db: AsyncSession,
    user: User,
    base_budget_id: uuid.UUID,
    data: UpdateBaseBudgetRequest,
    today: date,
) -> BaseBudgetResponse:
    """Update a base budget and return its API response

    Args:
        db: Active database session
        user: Authenticated user updating the base budget
        base_budget_id: Base budget identifier from the route path
        data: Base budget fields to update
        today: Current date in the user's timezone

    Returns:
        Updated base budget response

    Raises:
        HTTPException: User lacks admin access or update fields are invalid
    """
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.ADMIN)
    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        response = await get_base_budget_response(db, base_budget)
        return response

    # Evaluate the stored archived state before applying the patch so an unarchive request is not self-permitting
    fields_other_than_archived_flag = set(changed_fields) - {"is_archived"}

    # While archived a base budget only accepts clearing its archived flag so historical periods stay frozen
    if base_budget.is_archived and fields_other_than_archived_flag:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot edit an archived base budget",
        )

    # Handle tracked categories separately from simple field updates
    new_category_ids = changed_fields.pop("category_ids", None)

    # Capture the unarchive transition before applying fields so resumption can key off the prior state
    is_unarchiving = changed_fields.get("is_archived") is False and base_budget.is_archived

    for field, value in changed_fields.items():
        setattr(base_budget, field, value)

    if new_category_ids is not None:
        await update_tracked_category_links(
            db,
            base_budget_id,
            new_category_ids,
            user.id,
            base_budget.group_id,
            today,
        )

    # Resume generation only after the archived flag is cleared so the guard permits the current period
    if is_unarchiving:
        await resume_budget_generation_at_current_period(db, base_budget, today)

    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(base_budget)

    response = await get_base_budget_response(db, base_budget)
    return response
