"""Tax-advantaged plan metric service"""
import uuid
from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedPlan
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.services.tac_limit_metric_helpers import (
    attach_tac_limit_metrics,
    get_tac_limit_metrics,
    get_tac_plan_current_years,
)

_TAC_TRANSFER_CATEGORY_NAME = "Transfer"


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

    positive_amount_filter = Transaction.amount > 0
    negative_amount_filter = Transaction.amount < 0

    transfer_totals_by_plan_id: dict[uuid.UUID, dict[str, int]] = {
        plan.id: {
            "ytd_contributions": limit_metrics.limit_values_by_plan_year.get(
                (plan.id, current_years_by_plan_id[plan.id]),
                (0, None, 0, 0),
            )[2],
            "ytd_withdrawals": limit_metrics.limit_values_by_plan_year.get(
                (plan.id, current_years_by_plan_id[plan.id]),
                (0, None, 0, 0),
            )[3],
            "lifetime_contributions": plan.accrued_contributions,
            "lifetime_withdrawals": 0,
        }
        for plan in plans
    }

    # Sum transfer-category activity for linked accounts by TAC plan and transaction year
    transfer_total_result = await db.execute(
        select(
            Account.tax_advantaged_plan_id,
            func.extract("year", Transaction.dt).label("year"),
            func.coalesce(
                func.sum(case((positive_amount_filter, Transaction.amount), else_=0)),
                0,
            ).label("contributions"),
            func.coalesce(
                func.sum(case((negative_amount_filter, -Transaction.amount), else_=0)),
                0,
            ).label("withdrawals"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Account.tax_advantaged_plan_id.in_(plan_ids),

            # Archived accounts remain linked to their plan history
            Category.kind == CategoryKind.TRANSFER,
            Category.name == _TAC_TRANSFER_CATEGORY_NAME,
        )
        .group_by(Account.tax_advantaged_plan_id, "year"),
    )

    # Fold yearly transfer totals into current-year and lifetime fields for each plan
    for transfer_total_row in transfer_total_result:
        plan_id = transfer_total_row.tax_advantaged_plan_id
        transfer_totals_by_plan_id[plan_id]["lifetime_contributions"] += transfer_total_row.contributions
        transfer_totals_by_plan_id[plan_id]["lifetime_withdrawals"] += transfer_total_row.withdrawals
        if int(transfer_total_row.year) == current_years_by_plan_id[plan_id]:
            transfer_totals_by_plan_id[plan_id]["ytd_contributions"] += transfer_total_row.contributions
            transfer_totals_by_plan_id[plan_id]["ytd_withdrawals"] += transfer_total_row.withdrawals

    # Assign the completed transfer tallies onto each plan response row
    for plan in plans:
        transfer_totals = transfer_totals_by_plan_id[plan.id]
        plan.ytd_contributions = transfer_totals["ytd_contributions"]
        plan.ytd_withdrawals = transfer_totals["ytd_withdrawals"]
        plan.lifetime_contributions = transfer_totals["lifetime_contributions"]
        plan.lifetime_withdrawals = transfer_totals["lifetime_withdrawals"]
