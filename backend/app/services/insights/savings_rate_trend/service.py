"""Savings-rate trend service for the insights page"""

import uuid
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsSavingsRateTrendResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.savings_rate_trend.monthly_category_totals_helpers import (
    MonthlyCategoryTotalsByKey,
    get_converted_monthly_category_totals,
)
from app.utils.dates import (
    get_month_start_date,
    get_month_start_dates,
    get_shifted_month_start_date,
)

SAVINGS_RATE_TREND_MONTHS = 12

MonthlySavingsRateTotals = dict[date, dict[str, int]]


def _get_inclusive_month_count(start_month: date, end_month: date) -> int:
    """Return the number of months including both boundary months

    Args:
        start_month: First month start in the range
        end_month: Last month start in the range

    Returns:
        Inclusive number of months between the start and end months
    """
    # Count both boundary months so the response includes the visible start and current month
    month_count = ((end_month.year - start_month.year) * 12) + (end_month.month - start_month.month) + 1
    return month_count


async def _get_first_activity_month(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_end: date,
) -> date | None:
    """Return the first month with income or expense activity before a window end

    Args:
        db: Active database session
        account_ids: Account IDs included in the savings-rate trend
        window_end: Exclusive activity lookup end date

    Returns:
        First activity month, or None when there is no matching activity
    """
    # Find the earliest income or expense transaction before the trend window end
    result = await db.execute(
        select(func.min(Transaction.dt))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt < window_end,
        ),
    )
    first_activity = result.scalar_one_or_none()
    first_activity_month = get_month_start_date(first_activity) if first_activity else None
    return first_activity_month


def _build_empty_savings_rate_trend_response() -> InsightsSavingsRateTrendResponse:
    """Return an empty savings-rate trend response

    Returns:
        Savings-rate trend response payload with no points
    """
    response = InsightsSavingsRateTrendResponse(points=[])
    return response


def _get_monthly_savings_rate_totals(months: list[date], monthly_category_totals: MonthlyCategoryTotalsByKey) -> MonthlySavingsRateTotals:
    """Return monthly income and expense totals from signed category totals

    Args:
        months: Month starts included in the response
        monthly_category_totals: Converted monthly category totals keyed by month and category

    Returns:
        Income and expense totals keyed by month
    """
    totals = {month: {"income": 0, "expenses": 0} for month in months}

    # Classify signed category totals into monthly income and expense totals
    for (month, _category_id), total in monthly_category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    return totals


def _build_savings_rate_trend_response(
    months: list[date],
    totals: MonthlySavingsRateTotals,
    fx_status: FxStatus,
) -> InsightsSavingsRateTrendResponse:
    """Return savings-rate trend response from monthly totals

    Args:
        months: Month starts included in the response
        totals: Income and expense totals keyed by month
        fx_status: FX conversion status from monthly total loading

    Returns:
        Savings-rate trend response payload
    """
    points = [
        (
            month,
            totals[month]["income"],
            totals[month]["expenses"],
        )
        for month in months
    ]
    response = InsightsSavingsRateTrendResponse(points=points, fx_status=fx_status)
    return response


async def get_savings_rate_trend(
    db: AsyncSession,
    user: User,
    now: datetime,
) -> InsightsSavingsRateTrendResponse:
    """Return latest available sign-directed monthly totals for savings-rate trend

    Args:
        db: Active database session
        user: User requesting the savings-rate trend insight
        now: Current datetime in the user's timezone

    Returns:
        Savings-rate trend response payload
    """
    # Load accounts the user can read before finding monthly trend activity
    accounts = await get_accessible_accounts(db, user)
    account_ids = [account.id for account in accounts]
    if not account_ids:
        response = _build_empty_savings_rate_trend_response()
        return response

    current_month = get_month_start_date(now.date())
    window_end = get_shifted_month_start_date(current_month, 1)
    first_activity_month = await _get_first_activity_month(db, account_ids, window_end)
    if first_activity_month is None:
        response = _build_empty_savings_rate_trend_response()
        return response

    earliest_visible_month = get_shifted_month_start_date(current_month, -(SAVINGS_RATE_TREND_MONTHS - 1))
    start_month = max(first_activity_month, earliest_visible_month)
    month_count = _get_inclusive_month_count(start_month, current_month)
    months = get_month_start_dates(start_month, month_count)
    monthly_category_totals, fx_status = await get_converted_monthly_category_totals(
        db,
        accounts,
        user.base_currency,
        start_month,
        window_end,
    )
    totals = _get_monthly_savings_rate_totals(months, monthly_category_totals)
    response = _build_savings_rate_trend_response(months, totals, fx_status)
    return response
