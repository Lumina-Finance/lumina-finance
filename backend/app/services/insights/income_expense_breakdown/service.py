"""Income/expense category breakdown service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsComparisonPeriod, InsightsIncomeExpenseBreakdownResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.common import comparison_period_bounds
from app.services.insights.income_expense_breakdown.breakdown_rows import (
    get_income_expense_breakdown_rows,
    get_income_expense_breakdown_stats_by_side,
    get_income_expense_breakdown_total,
)
from app.services.insights.income_expense_breakdown.period_stats import (
    get_income_expense_breakdown_period_stats,
)
from app.services.insights.income_expense_breakdown.trend_rows import (
    get_income_expense_breakdown_category_stats,
    get_income_expense_breakdown_trend_rows,
)


def _combine_fx_statuses(current_status: FxStatus, previous_status: FxStatus) -> FxStatus:
    """Return one FX status for current and comparison period calculations

    Args:
        current_status: FX status from the selected period
        previous_status: FX status from the comparison period

    Returns:
        Combined FX status with duplicate missing pairs removed
    """
    if current_status.state == "none":
        return previous_status
    if previous_status.state == "none":
        return current_status

    missing_pairs = []
    seen_pairs = set()
    for status in (current_status, previous_status):
        for pair in status.missing_pairs:
            key = (pair.base, pair.quote)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            missing_pairs.append(pair)

    if not missing_pairs:
        return FxStatus(state="complete")

    state = "unavailable" if current_status.state == previous_status.state == "unavailable" else "incomplete"
    return FxStatus(state=state, missing_pairs=missing_pairs)


async def get_income_expense_breakdown(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsIncomeExpenseBreakdownResponse:
    """Return category breakdown and trend rows for the income/expense card

    Args:
        db: Active database session
        user: User requesting the insight summary
        from_date: Inclusive selected period start date
        to_date: Inclusive selected period end date
        comparison_period: Comparison period used for trend rows

    Returns:
        Income and expense breakdown response payload
    """
    previous_from_date, previous_to_date = comparison_period_bounds(from_date, to_date, comparison_period)
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        return InsightsIncomeExpenseBreakdownResponse(
            expense=[],
            income=[],
            expense_total=0,
            income_total=0,
            expense_increases=[],
            expense_decreases=[],
            income_increases=[],
            income_decreases=[],
        )

    current_period_stats, current_fx_status = await get_income_expense_breakdown_period_stats(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    previous_period_stats, previous_fx_status = await get_income_expense_breakdown_period_stats(
        db,
        accounts,
        user.base_currency,
        previous_from_date,
        previous_to_date,
    )
    current_expense_breakdown, current_income_breakdown = get_income_expense_breakdown_stats_by_side(current_period_stats)
    current_expense_stats = get_income_expense_breakdown_category_stats(current_period_stats, CategoryKind.EXPENSE)
    previous_expense_stats = get_income_expense_breakdown_category_stats(previous_period_stats, CategoryKind.EXPENSE)
    current_income_stats = get_income_expense_breakdown_category_stats(current_period_stats, CategoryKind.INCOME)
    previous_income_stats = get_income_expense_breakdown_category_stats(previous_period_stats, CategoryKind.INCOME)

    expense_increases, expense_decreases = get_income_expense_breakdown_trend_rows(current_expense_stats, previous_expense_stats)
    income_increases, income_decreases = get_income_expense_breakdown_trend_rows(current_income_stats, previous_income_stats)
    expense_refunds = sum(
        stats.amount
        for stats in current_income_breakdown.values()
        if stats.category_kind == CategoryKind.EXPENSE
    )
    income_losses = sum(
        stats.amount
        for stats in current_expense_breakdown.values()
        if stats.category_kind == CategoryKind.INCOME
    )

    return InsightsIncomeExpenseBreakdownResponse(
        expense=get_income_expense_breakdown_rows(current_expense_breakdown),
        income=get_income_expense_breakdown_rows(current_income_breakdown),
        expense_total=max(get_income_expense_breakdown_total(current_expense_breakdown) - expense_refunds, 0),
        income_total=max(get_income_expense_breakdown_total(current_income_breakdown) - income_losses, 0),
        expense_increases=expense_increases,
        expense_decreases=expense_decreases,
        income_increases=income_increases,
        income_decreases=income_decreases,
        fx_status=_combine_fx_statuses(current_fx_status, previous_fx_status),
    )
