"""TAC transfer metric helpers"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedCategory
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.services.tax_advantaged_categories.tac_limit_metric_helpers import TacLimitMetrics

_TAC_TRANSFER_CATEGORY_NAME = "Transfer"


@dataclass
class TacTransferTotals:
    """TAC transfer totals grouped for tax-advantaged category response metric assignment"""

    ytd_contributions: int
    ytd_withdrawals: int
    lifetime_contributions: int
    lifetime_withdrawals: int


async def get_tac_transfer_totals(
    db: AsyncSession,
    tax_advantaged_categories: Sequence[TaxAdvantagedCategory],
    tax_advantaged_category_ids: Sequence[uuid.UUID],
    current_years_by_tax_advantaged_category_id: dict[uuid.UUID, int],
    limit_metrics: TacLimitMetrics,
) -> dict[uuid.UUID, TacTransferTotals]:
    """Return transfer totals for TAC category responses

    Args:
        db: Active database session
        tax_advantaged_categories: Tax-advantaged category rows being enriched
        tax_advantaged_category_ids: Tax-advantaged category identifiers being enriched
        current_years_by_tax_advantaged_category_id: Current calendar year keyed by tax-advantaged category identifier
        limit_metrics: Configured TAC limit metrics used as starting totals

    Returns:
        TAC transfer totals keyed by tax-advantaged category identifier
    """
    transfer_totals_by_tax_advantaged_category_id = _build_initial_tac_transfer_totals(
        tax_advantaged_categories,
        current_years_by_tax_advantaged_category_id,
        limit_metrics,
    )
    positive_amount_filter = Transaction.amount > 0
    negative_amount_filter = Transaction.amount < 0

    # Sum transfer-category activity for linked accounts by TAC category and transaction year
    transfer_total_result = await db.execute(
        select(
            Account.tax_advantaged_category_id,
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
            Account.tax_advantaged_category_id.in_(tax_advantaged_category_ids),

            # Archived accounts remain linked to their tax-advantaged category history
            Category.kind == CategoryKind.TRANSFER,
            Category.name == _TAC_TRANSFER_CATEGORY_NAME,
        )
        .group_by(Account.tax_advantaged_category_id, "year"),
    )

    # Fold yearly transfer totals into current-year and lifetime fields for each category
    for transfer_total_row in transfer_total_result:
        tax_advantaged_category_id = transfer_total_row.tax_advantaged_category_id
        transfer_totals = transfer_totals_by_tax_advantaged_category_id[tax_advantaged_category_id]
        transfer_totals.lifetime_contributions += transfer_total_row.contributions
        transfer_totals.lifetime_withdrawals += transfer_total_row.withdrawals
        if int(transfer_total_row.year) == current_years_by_tax_advantaged_category_id[tax_advantaged_category_id]:
            transfer_totals.ytd_contributions += transfer_total_row.contributions
            transfer_totals.ytd_withdrawals += transfer_total_row.withdrawals

    return transfer_totals_by_tax_advantaged_category_id


def attach_tac_transfer_totals(
    tax_advantaged_categories: Sequence[TaxAdvantagedCategory],
    transfer_totals_by_tax_advantaged_category_id: dict[uuid.UUID, TacTransferTotals],
) -> None:
    """Attach TAC transfer totals to tax-advantaged category rows

    Args:
        tax_advantaged_categories: Tax-advantaged category rows to enrich in place
        transfer_totals_by_tax_advantaged_category_id: TAC transfer totals keyed by tax-advantaged category identifier
    """
    # Assign the completed transfer totals onto each tax-advantaged category response row
    for tax_advantaged_category in tax_advantaged_categories:
        transfer_totals = transfer_totals_by_tax_advantaged_category_id[tax_advantaged_category.id]
        tax_advantaged_category.ytd_contributions = transfer_totals.ytd_contributions
        tax_advantaged_category.ytd_withdrawals = transfer_totals.ytd_withdrawals
        tax_advantaged_category.lifetime_contributions = transfer_totals.lifetime_contributions
        tax_advantaged_category.lifetime_withdrawals = transfer_totals.lifetime_withdrawals


def _build_initial_tac_transfer_totals(
    tax_advantaged_categories: Sequence[TaxAdvantagedCategory],
    current_years_by_tax_advantaged_category_id: dict[uuid.UUID, int],
    limit_metrics: TacLimitMetrics,
) -> dict[uuid.UUID, TacTransferTotals]:
    """Build starting TAC transfer totals from configured limits

    Args:
        tax_advantaged_categories: Tax-advantaged category rows being enriched
        current_years_by_tax_advantaged_category_id: Current calendar year keyed by tax-advantaged category identifier
        limit_metrics: Configured TAC limit metrics used as starting totals

    Returns:
        Starting TAC transfer totals keyed by tax-advantaged category identifier
    """
    transfer_totals_by_tax_advantaged_category_id = {
        tax_advantaged_category.id: TacTransferTotals(
            ytd_contributions=limit_metrics.limit_values_by_category_year.get(
                (tax_advantaged_category.id, current_years_by_tax_advantaged_category_id[tax_advantaged_category.id]),
                (0, None, 0, 0),
            )[2],
            ytd_withdrawals=limit_metrics.limit_values_by_category_year.get(
                (tax_advantaged_category.id, current_years_by_tax_advantaged_category_id[tax_advantaged_category.id]),
                (0, None, 0, 0),
            )[3],
            lifetime_contributions=tax_advantaged_category.accrued_contributions,
            lifetime_withdrawals=0,
        )
        for tax_advantaged_category in tax_advantaged_categories
    }
    return transfer_totals_by_tax_advantaged_category_id
