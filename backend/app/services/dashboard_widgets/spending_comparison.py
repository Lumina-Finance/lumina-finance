"""Spending-comparison dashboard widget service"""
from datetime import date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.dashboard import RangeKind, SpendingComparisonResponse
from app.schemas.fx import FxStatus
from app.services.dashboard_widgets.spending_comparison_daily_expense_helpers import (
    get_converted_spending_comparison_daily_expenses,
)
from app.services.dashboard_widgets.spending_comparison_range_helpers import get_spending_comparison_slot_ranges


async def get_spending_comparison(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    range_: RangeKind,
    now: datetime,
) -> SpendingComparisonResponse:
    """Return current-vs-prior cumulative expense series for a range

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        range_: Calendar period used for current and prior comparison slots
        now: Viewer-local timestamp used to derive current-period bounds

    Returns:
        Spending comparison response with slot labels, cumulative totals, and FX status
    """
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges(range_, now.date())

    if not accounts:
        response = SpendingComparisonResponse(
            range=range_,
            slot_labels=labels,
            current=[0] * len(current_ranges),
            previous=[0] * len(previous_ranges),
            fx_status=FxStatus(),
        )
        return response

    accounts_by_id = {account.id: account for account in accounts}
    converted_daily_expenses = await get_converted_spending_comparison_daily_expenses(
        db,
        accounts_by_id,
        base_currency,
        current_ranges,
        previous_ranges,
    )

    current_slot_totals = [
        _sum_days(converted_daily_expenses.current_daily_expenses, date_range[0], date_range[1])
        for date_range in current_ranges
    ]
    previous_slot_totals = [
        _sum_days(converted_daily_expenses.previous_daily_expenses, date_range[0], date_range[1])
        for date_range in previous_ranges
    ]

    response = SpendingComparisonResponse(
        range=range_,
        slot_labels=labels,
        current=_cumulative_totals(current_slot_totals),
        previous=_cumulative_totals(previous_slot_totals),
        fx_status=converted_daily_expenses.fx_status,
    )
    return response


def _sum_days(daily_values: dict[date, int], start: date, end: date) -> int:
    """Sum daily totals across an inclusive date range

    Args:
        daily_values: Daily totals keyed by date
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Sum of daily values inside the requested range
    """
    total = 0
    current_day = start
    while current_day <= end:
        total += daily_values.get(current_day, 0)
        current_day += timedelta(days=1)
    return total


def _cumulative_totals(values: list[int]) -> list[int]:
    """Return the running cumulative sum of values

    Args:
        values: Ordered values to accumulate

    Returns:
        Running cumulative totals with the same length as ``values``
    """
    running = 0
    cumulative_values: list[int] = []
    for value in values:
        running += value
        cumulative_values.append(running)
    return cumulative_values
