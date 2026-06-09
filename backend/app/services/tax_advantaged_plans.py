"""Tax-advantaged plan metric service"""
from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan
from app.services.tac_limit_metric_helpers import (
    attach_tac_limit_metrics,
    get_tac_limit_metrics,
    get_tac_plan_current_years,
)
from app.services.tac_transfer_metric_helpers import (
    attach_tac_transfer_totals,
    get_tac_transfer_totals,
)


def _get_current_datetime_for_timezone(timezone: ZoneInfo) -> datetime:
    """Return the current datetime for a timezone

    Args:
        timezone: Timezone used for the current datetime

    Returns:
        Current datetime in the supplied timezone
    """
    current_datetime = datetime.now(timezone)
    return current_datetime


async def attach_tax_advantaged_plan_metrics(
    db: AsyncSession,
    plans: Sequence[TaxAdvantagedPlan],
) -> None:
    """Attach current-year limits and transfer tallies to plan rows

    Archived linked accounts are included because contribution and withdrawal
    room is historical tax data, not active account availability

    Args:
        db: Active database session
        plans: Plan rows to enrich in place
    """
    if not plans:
        return

    plan_ids = [plan.id for plan in plans]
    current_years_by_plan_id = await get_tac_plan_current_years(db, plans, _get_current_datetime_for_timezone)
    limit_metrics = await get_tac_limit_metrics(db, plan_ids, current_years_by_plan_id)
    attach_tac_limit_metrics(plans, current_years_by_plan_id, limit_metrics)
    transfer_totals_by_plan_id = await get_tac_transfer_totals(
        db,
        plans,
        plan_ids,
        current_years_by_plan_id,
        limit_metrics,
    )
    attach_tac_transfer_totals(plans, transfer_totals_by_plan_id)
