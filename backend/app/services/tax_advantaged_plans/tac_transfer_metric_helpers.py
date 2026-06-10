"""TAC transfer metric helpers"""
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedPlan
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.services.tax_advantaged_plans.tac_limit_metric_helpers import TacLimitMetrics

_TAC_TRANSFER_CATEGORY_NAME = "Transfer"


@dataclass
class TacTransferTotals:
    """TAC transfer totals grouped for plan response metric assignment"""

    ytd_contributions: int
    ytd_withdrawals: int
    lifetime_contributions: int
    lifetime_withdrawals: int


async def get_tac_transfer_totals(
    db: AsyncSession,
    plans: Sequence[TaxAdvantagedPlan],
    plan_ids: Sequence[uuid.UUID],
    current_years_by_plan_id: dict[uuid.UUID, int],
    limit_metrics: TacLimitMetrics,
) -> dict[uuid.UUID, TacTransferTotals]:
    """Return transfer totals for TAC plan responses

    Args:
        db: Active database session
        plans: Plan rows being enriched
        plan_ids: Plan identifiers being enriched
        current_years_by_plan_id: Current calendar year keyed by plan identifier
        limit_metrics: Configured TAC limit metrics used as starting totals

    Returns:
        TAC transfer totals keyed by plan identifier
    """
    transfer_totals_by_plan_id = _build_initial_tac_transfer_totals(plans, current_years_by_plan_id, limit_metrics)
    positive_amount_filter = Transaction.amount > 0
    negative_amount_filter = Transaction.amount < 0

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
        transfer_totals = transfer_totals_by_plan_id[plan_id]
        transfer_totals.lifetime_contributions += transfer_total_row.contributions
        transfer_totals.lifetime_withdrawals += transfer_total_row.withdrawals
        if int(transfer_total_row.year) == current_years_by_plan_id[plan_id]:
            transfer_totals.ytd_contributions += transfer_total_row.contributions
            transfer_totals.ytd_withdrawals += transfer_total_row.withdrawals

    return transfer_totals_by_plan_id


def attach_tac_transfer_totals(
    plans: Sequence[TaxAdvantagedPlan],
    transfer_totals_by_plan_id: dict[uuid.UUID, TacTransferTotals],
) -> None:
    """Attach TAC transfer totals to plan rows

    Args:
        plans: Plan rows to enrich in place
        transfer_totals_by_plan_id: TAC transfer totals keyed by plan identifier
    """
    # Assign the completed transfer totals onto each plan response row
    for plan in plans:
        transfer_totals = transfer_totals_by_plan_id[plan.id]
        plan.ytd_contributions = transfer_totals.ytd_contributions
        plan.ytd_withdrawals = transfer_totals.ytd_withdrawals
        plan.lifetime_contributions = transfer_totals.lifetime_contributions
        plan.lifetime_withdrawals = transfer_totals.lifetime_withdrawals


def _build_initial_tac_transfer_totals(
    plans: Sequence[TaxAdvantagedPlan],
    current_years_by_plan_id: dict[uuid.UUID, int],
    limit_metrics: TacLimitMetrics,
) -> dict[uuid.UUID, TacTransferTotals]:
    """Build starting TAC transfer totals from configured limits

    Args:
        plans: Plan rows being enriched
        current_years_by_plan_id: Current calendar year keyed by plan identifier
        limit_metrics: Configured TAC limit metrics used as starting totals

    Returns:
        Starting TAC transfer totals keyed by plan identifier
    """
    transfer_totals_by_plan_id = {
        plan.id: TacTransferTotals(
            ytd_contributions=limit_metrics.limit_values_by_plan_year.get(
                (plan.id, current_years_by_plan_id[plan.id]),
                (0, None, 0, 0),
            )[2],
            ytd_withdrawals=limit_metrics.limit_values_by_plan_year.get(
                (plan.id, current_years_by_plan_id[plan.id]),
                (0, None, 0, 0),
            )[3],
            lifetime_contributions=plan.accrued_contributions,
            lifetime_withdrawals=0,
        )
        for plan in plans
    }
    return transfer_totals_by_plan_id
