"""Income/expense category breakdown service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.user import User
from app.schemas.insights import InsightsComparisonPeriod, InsightsIncomeExpenseBreakdownResponse
from app.services.accounts.access import get_accessible_accounts
from app.services.insights.common import comparison_period_bounds
from app.services.insights.income_expense_breakdown.breakdown_row_helpers import (
    get_income_expense_breakdown_stats_by_side,
)
from app.services.insights.income_expense_breakdown.period_stat_helpers import (
    get_income_expense_breakdown_period_stats,
)
from app.services.insights.income_expense_breakdown.response_helpers import build_income_expense_breakdown_response
from app.services.insights.income_expense_breakdown.trend_row_helpers import (
    get_income_expense_breakdown_category_stats,
    get_income_expense_breakdown_trend_rows,
)


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

    return build_income_expense_breakdown_response(
        current_expense_breakdown=current_expense_breakdown,
        current_income_breakdown=current_income_breakdown,
        expense_increases=expense_increases,
        expense_decreases=expense_decreases,
        income_increases=income_increases,
        income_decreases=income_decreases,
        current_fx_status=current_fx_status,
        previous_fx_status=previous_fx_status,
    )
