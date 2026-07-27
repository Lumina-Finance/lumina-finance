"""Savings-rate dashboard widget service"""
from datetime import date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.config.dashboard import DASHBOARD_SAVINGS_HISTORY_MONTHS
from app.models.account import Account
from app.schemas.dashboard import MonthlyIncomeExpense
from app.schemas.fx import FxStatus
from app.services.savings_rate.monthly_category_total_helpers import (
    SavingsRateMonthlyCategoryTotalsByKey,
    get_converted_savings_rate_monthly_category_totals,
)
from app.utils.dates import get_next_month_start_date, get_recent_month_start_dates

_MonthlySavingsRateTotals = dict[date, dict[str, int]]


async def get_savings_rate_history(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    now: datetime,
) -> tuple[list[MonthlyIncomeExpense], FxStatus]:
    """Return per-month income and expense totals for the savings-rate chart

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        now: Viewer-local timestamp used to derive the calendar window

    Returns:
        Oldest-first monthly income and expense history plus FX status
    """
    months_count = DASHBOARD_SAVINGS_HISTORY_MONTHS
    months = get_recent_month_start_dates(now, months_count)
    first_month = months[0]
    window_end = get_next_month_start_date(now)

    empty_history = [MonthlyIncomeExpense(month=month, income=0, expenses=0) for month in months]
    if not accounts:
        fx_status = FxStatus()
        return empty_history, fx_status

    monthly_category_totals, fx_status = await get_converted_savings_rate_monthly_category_totals(
        db,
        accounts,
        base_currency,
        first_month,
        window_end,
        prefetch_start_date=first_month,
        prefetch_end_date=window_end - timedelta(days=1),
    )
    history = _build_savings_rate_history(months, monthly_category_totals)
    return history, fx_status


def _build_savings_rate_history(
    months: list[date],
    monthly_category_totals: SavingsRateMonthlyCategoryTotalsByKey,
) -> list[MonthlyIncomeExpense]:
    """Return monthly income and expense history from category totals

    Args:
        months: Month starts included in the dashboard widget
        monthly_category_totals: Converted monthly category totals keyed by month and category

    Returns:
        Monthly income and expense history ordered by month
    """
    totals = _get_monthly_savings_rate_totals(months, monthly_category_totals)
    history = [
        MonthlyIncomeExpense(
            month=month,
            income=totals[month]["income"],
            expenses=totals[month]["expenses"],
        )
        for month in months
    ]
    return history


def _get_monthly_savings_rate_totals(
    months: list[date],
    monthly_category_totals: SavingsRateMonthlyCategoryTotalsByKey,
) -> _MonthlySavingsRateTotals:
    """Return monthly income and expense totals from signed category totals

    Args:
        months: Month starts included in the dashboard widget
        monthly_category_totals: Converted monthly category totals keyed by month and category

    Returns:
        Income and expense totals keyed by month
    """
    totals = {month: {"income": 0, "expenses": 0} for month in months}

    # Net each category before assigning the signed result to income or expenses
    for (month, _category_id), total in monthly_category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    return totals
