"""Spending-comparison dashboard widget service"""

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.dashboard import RangeKind, SpendingComparisonResponse
from app.schemas.fx import FxStatus
from app.services.dashboard_widgets.spending_comparison.daily_expense_helpers import (
    get_converted_average_history,
    get_converted_spending_comparison_daily_expenses,
)
from app.services.dashboard_widgets.spending_comparison.daily_expense_query_helpers import (
    query_first_transaction_date,
)
from app.services.dashboard_widgets.spending_comparison.range_helpers import (
    DateSlotRange,
    get_spending_comparison_slot_ranges,
)
from app.services.dashboard_widgets.spending_comparison.slot_total_helpers import (
    cumulative_totals,
    get_average_slot_sums,
    get_completed_period_slot_ranges,
    sum_days,
)


async def get_spending_comparison(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    range_: RangeKind,
    now: datetime,
    include_average: bool = False,
) -> SpendingComparisonResponse:
    """Return current-vs-prior cumulative expense series for a range

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        range_: Calendar period used for current and prior comparison slots
        now: Viewer-local timestamp used to derive current-period bounds
        include_average: Whether to load the earlier periods and their FX rates for the average. Without it
            only how many periods the average would cover is worked out, from the first transaction's date

    Returns:
        Spending comparison response with slot labels, cumulative totals, the average's sums when asked for,
        and FX status
    """
    today = now.date()
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges(range_, today)

    if not accounts:
        response = SpendingComparisonResponse(
            range=range_,
            slot_labels=labels,
            current=[0] * len(current_ranges),
            previous=[0] * len(previous_ranges),
            average_sums=[],
            average_counts=[],
            fx_status=FxStatus(),
        )
        return response

    accounts_by_id = {account.id: account for account in accounts}
    first_transaction_date = await query_first_transaction_date(db, list(accounts_by_id), today)
    average_periods = (
        get_completed_period_slot_ranges(range_, current_ranges[0][0], first_transaction_date) if first_transaction_date is not None else []
    )

    converted_daily_expenses = await get_converted_spending_comparison_daily_expenses(
        db,
        accounts_by_id,
        base_currency,
        current_ranges,
        previous_ranges,
    )

    current_slot_totals = [
        sum_days(converted_daily_expenses.current_daily_expenses, date_range[0], date_range[1]) for date_range in current_ranges
    ]
    previous_slot_totals = [
        sum_days(converted_daily_expenses.previous_daily_expenses, date_range[0], date_range[1]) for date_range in previous_ranges
    ]
    average_sums: list[int] = []
    average_counts: list[int] = []
    average_fx_status = FxStatus()
    if include_average and average_periods:
        # Periods come newest first, so the history runs from the oldest period's first day to the newest's last
        history_window: DateSlotRange = (average_periods[-1][0][0], average_periods[0][-1][1])
        history = await get_converted_average_history(db, accounts_by_id, base_currency, history_window)
        average_sums, average_counts = get_average_slot_sums(average_periods, history.daily_expenses, len(labels))
        average_fx_status = history.fx_status

    response = SpendingComparisonResponse(
        range=range_,
        slot_labels=labels,
        current=cumulative_totals(current_slot_totals),
        previous=cumulative_totals(previous_slot_totals),
        average_periods=len(average_periods),
        average_sums=average_sums,
        average_counts=average_counts,
        fx_status=converted_daily_expenses.fx_status,
        average_fx_status=average_fx_status,
    )
    return response
