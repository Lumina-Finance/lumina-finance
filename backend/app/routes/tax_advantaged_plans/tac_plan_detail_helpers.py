"""TAC plan detail helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan
from app.routes.tax_advantaged_plans.tac_plan_helpers import get_owned_tax_advantaged_plan_or_404
from app.services.tax_advantaged_plans import attach_tax_advantaged_plan_metrics


async def get_tax_advantaged_plan_with_metrics_for_owner(
    db: AsyncSession,
    plan_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> TaxAdvantagedPlan:
    """Return an owned tax-advantaged plan with current-year metrics

    Args:
        db: Active database session
        plan_id: Plan identifier to fetch
        owner_id: Authenticated owner identifier

    Returns:
        Owned tax-advantaged plan with current-year metrics attached

    Raises:
        HTTPException: Plan does not exist or belongs to another user
    """
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, owner_id)
    await attach_tax_advantaged_plan_metrics(db, [plan])
    return plan
