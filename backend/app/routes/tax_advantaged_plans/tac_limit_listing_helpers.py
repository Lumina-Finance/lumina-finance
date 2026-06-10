"""TAC limit listing helpers"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlanLimit
from app.routes.tax_advantaged_plans.tac_limit_helpers import get_tac_limits_for_plan
from app.routes.tax_advantaged_plans.tac_plan_helpers import get_owned_tax_advantaged_plan_or_404


async def get_tac_limits_for_owned_plan(
    db: AsyncSession,
    plan_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> Sequence[TaxAdvantagedPlanLimit]:
    """Return yearly TAC limits after checking plan ownership

    Args:
        db: Active database session
        plan_id: Plan identifier whose limits should be listed
        owner_id: Authenticated owner identifier

    Returns:
        Yearly TAC limits ordered by year

    Raises:
        HTTPException: Plan does not exist or belongs to another user
    """
    await get_owned_tax_advantaged_plan_or_404(db, plan_id, owner_id)
    limit_rows = await get_tac_limits_for_plan(db, plan_id)
    return limit_rows
