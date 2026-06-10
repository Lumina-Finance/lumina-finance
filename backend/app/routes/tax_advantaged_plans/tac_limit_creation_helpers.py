"""TAC limit creation helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlanLimit
from app.routes.tax_advantaged_plans.tac_limit_helpers import build_tac_limit, validate_tac_limit_year_available
from app.routes.tax_advantaged_plans.tac_plan_helpers import get_owned_tax_advantaged_plan_or_404
from app.schemas.tax_advantaged_plan import CreateTaxAdvantagedPlanLimitRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def create_tac_limit_for_owned_plan(
    db: AsyncSession,
    plan_id: uuid.UUID,
    owner_id: uuid.UUID,
    data: CreateTaxAdvantagedPlanLimitRequest,
) -> TaxAdvantagedPlanLimit:
    """Create a yearly TAC limit after checking plan ownership

    Args:
        db: Active database session
        plan_id: Plan identifier that owns the limit row
        owner_id: Authenticated owner identifier
        data: Yearly limit creation payload

    Returns:
        Created yearly TAC limit

    Raises:
        HTTPException: Plan is inaccessible or the year already has a limit row
    """
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, owner_id)
    await validate_tac_limit_year_available(db, plan_id, data.year)

    limit_row = build_tac_limit(plan_id, data)
    db.add(limit_row)

    # Mark the plan scope stale before committing the new yearly limit
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
    await db.refresh(limit_row)
    return limit_row
