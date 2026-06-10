"""TAC plan listing helpers"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan
from app.routes.tax_advantaged_plans.tac_plan_helpers import get_tax_advantaged_plans_for_owner
from app.services.tax_advantaged_plans import attach_tax_advantaged_plan_metrics


async def get_tax_advantaged_plans_with_metrics_for_owner(
    db: AsyncSession,
    owner_id: uuid.UUID,
) -> Sequence[TaxAdvantagedPlan]:
    """Return tax-advantaged plans with current-year metrics for an owner

    Args:
        db: Active database session
        owner_id: Authenticated owner identifier

    Returns:
        Tax-advantaged plans with current-year metrics attached
    """
    plans = await get_tax_advantaged_plans_for_owner(db, owner_id)
    await attach_tax_advantaged_plan_metrics(db, plans)
    return plans
