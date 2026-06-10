"""TAC plan update helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan
from app.routes.tax_advantaged_plans.tac_plan_helpers import (
    apply_tac_plan_updates,
    get_owned_tax_advantaged_plan_or_404,
    validate_tac_plan_updates,
)
from app.schemas.tax_advantaged_plan import UpdateTaxAdvantagedPlanRequest
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.tax_advantaged_plans import attach_tax_advantaged_plan_metrics


async def update_tax_advantaged_plan_with_metrics(
    db: AsyncSession,
    plan_id: uuid.UUID,
    owner_id: uuid.UUID,
    data: UpdateTaxAdvantagedPlanRequest,
) -> TaxAdvantagedPlan:
    """Update an owned tax-advantaged plan with current-year metrics

    Args:
        db: Active database session
        plan_id: Plan identifier to update
        owner_id: Authenticated owner identifier
        data: Partial plan update payload

    Returns:
        Updated tax-advantaged plan with current-year metrics attached

    Raises:
        HTTPException: Plan is inaccessible or a supplied field is invalid
    """
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, owner_id)
    previous_group_id = plan.group_id
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        await attach_tax_advantaged_plan_metrics(db, [plan])
        return plan

    await validate_tac_plan_updates(db, updates, owner_id)
    apply_tac_plan_updates(plan, updates)

    # Mark the previous scope stale because updates can affect plan metrics there
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=previous_group_id)

    # Mark the new scope stale when the plan moves into a different group
    if plan.group_id != previous_group_id:
        await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)

    await db.commit()
    await db.refresh(plan)
    await attach_tax_advantaged_plan_metrics(db, [plan])
    return plan
