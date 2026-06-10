"""TAC plan creation helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan
from app.routes.tax_advantaged_plans.tac_plan_helpers import (
    build_tac_plan,
    validate_tax_advantaged_plan_currency,
    validate_tax_advantaged_plan_group_scope,
    validate_tax_advantaged_plan_tax_treatment,
)
from app.schemas.tax_advantaged_plan import CreateTaxAdvantagedPlanRequest
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.tax_advantaged_plans import attach_tax_advantaged_plan_metrics


async def create_tax_advantaged_plan_with_metrics(
    db: AsyncSession,
    owner_id: uuid.UUID,
    data: CreateTaxAdvantagedPlanRequest,
) -> TaxAdvantagedPlan:
    """Create a tax-advantaged plan with current-year metrics attached

    Args:
        db: Active database session
        owner_id: Authenticated owner identifier
        data: Plan creation payload

    Returns:
        Created plan with current-year metrics attached

    Raises:
        HTTPException: Tax treatment, group scope, or currency is invalid
    """
    validate_tax_advantaged_plan_tax_treatment(data.tax_treatment)
    await validate_tax_advantaged_plan_group_scope(db, data.group_id, owner_id)
    await validate_tax_advantaged_plan_currency(db, data.currency)

    plan = build_tac_plan(owner_id, data)
    db.add(plan)

    # Mark the plan scope stale before committing the newly created plan
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
    await db.refresh(plan)
    await attach_tax_advantaged_plan_metrics(db, [plan])
    return plan
