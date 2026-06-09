"""Spending-breakdown dashboard widget service"""
from datetime import date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.schemas.dashboard import RangeKind, SpendingBreakdownResponse
from app.services.dashboard_widgets.spending_breakdown_category_total_helpers import get_converted_spending_breakdown_category_totals
from app.services.dashboard_widgets.spending_breakdown_response_helpers import (
    build_empty_spending_breakdown_response,
    get_limited_spending_breakdown_categories,
    get_spending_breakdown_categories_by_sign,
    get_spending_breakdown_totals,
)


async def get_spending_breakdown(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    range_: RangeKind,
    now: datetime,
) -> SpendingBreakdownResponse:
    """Return category-level expense and income totals for a range

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        range_: Calendar period used for the breakdown totals
        now: Viewer-local timestamp used to derive current-period bounds

    Returns:
        Spending and income breakdown response with FX status
    """
    start, end = _current_period_bounds(range_, now.date())
    if not accounts:
        response = build_empty_spending_breakdown_response(range_)
        return response

    accounts_by_id = {account.id: account for account in accounts}
    converted_category_totals = await get_converted_spending_breakdown_category_totals(
        db,
        accounts_by_id,
        base_currency,
        start,
        end,
    )
    expense_categories, income_categories = get_spending_breakdown_categories_by_sign(
        converted_category_totals.category_totals,
    )
    expense_total, income_total = get_spending_breakdown_totals(expense_categories, income_categories)

    response = SpendingBreakdownResponse(
        range=range_,
        expense=get_limited_spending_breakdown_categories(expense_categories, CategoryKind.EXPENSE),
        income=get_limited_spending_breakdown_categories(income_categories, CategoryKind.INCOME),
        expense_total=expense_total,
        income_total=income_total,
        fx_status=converted_category_totals.fx_status,
    )
    return response


def _current_period_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return current-period date bounds for a dashboard range

    Args:
        range_: Calendar period requested by the dashboard
        today: Viewer-local current date

    Returns:
        Inclusive start and end dates for the current period
    """
    if range_ == "WTD":
        return today - timedelta(days=today.weekday()), today
    if range_ == "MTD":
        return date(today.year, today.month, 1), today
    if range_ == "QTD":
        quarter_month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, quarter_month, 1), today
    return date(today.year, 1, 1), today
