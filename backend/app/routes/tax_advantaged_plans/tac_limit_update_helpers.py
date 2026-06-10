"""TAC limit update helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlanLimit
from app.routes.tax_advantaged_plans.tac_limit_helpers import apply_tac_limit_updates, get_tac_limit_or_404
from app.routes.tax_advantaged_plans.tac_plan_helpers import get_owned_tax_advantaged_plan_or_404
from app.schemas.tax_advantaged_plan import UpdateTaxAdvantagedPlanLimitRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def update_tac_limit_for_owned_plan(
    db: AsyncSession,
    plan_id: uuid.UUID,
    year: int,
    owner_id: uuid.UUID,
    data: UpdateTaxAdvantagedPlanLimitRequest,
) -> TaxAdvantagedPlanLimit:
    """Update a yearly TAC limit after checking plan ownership

    Args:
        db: Active database session
        plan_id: Plan identifier that owns the limit row
        year: Year to update
        owner_id: Authenticated owner identifier
        data: Partial yearly limit update payload

    Returns:
        Updated yearly TAC limit

    Raises:
        HTTPException: Plan or limit row is inaccessible, missing, or invalid
    """
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, owner_id)
    limit_row = await get_tac_limit_or_404(db, plan_id, year)
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return limit_row

    apply_tac_limit_updates(limit_row, updates)

    # Mark the plan scope stale before committing the yearly limit changes
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
    await db.refresh(limit_row)
    return limit_row
