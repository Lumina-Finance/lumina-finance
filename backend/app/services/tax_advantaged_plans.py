import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan, TaxAdvantagedPlanLimit


async def attach_current_year_plan_limits(
    db: AsyncSession,
    plans: Sequence[TaxAdvantagedPlan],
) -> None:
    """Attach current-year contribution/withdrawal limit fields to plan rows.

    Args:
        db: Active database session.
        plans: Plan rows to enrich in place.
    """
    if not plans:
        return

    plan_ids = [p.id for p in plans]
    current_year = datetime.now(UTC).year
    limits: dict[uuid.UUID, tuple[int, int | None]] = {}

    result = await db.execute(
        select(
            TaxAdvantagedPlanLimit.plan_id,
            TaxAdvantagedPlanLimit.contribution_limit,
            TaxAdvantagedPlanLimit.withdrawal_limit,
        ).where(
            TaxAdvantagedPlanLimit.plan_id.in_(plan_ids),
            TaxAdvantagedPlanLimit.year == current_year,
        ),
    )
    for row in result:
        limits[row.plan_id] = (row.contribution_limit, row.withdrawal_limit)

    for plan in plans:
        row = limits.get(plan.id)
        plan.current_year_contribution_limit = row[0] if row else None
        plan.current_year_withdrawal_limit = row[1] if row else None
