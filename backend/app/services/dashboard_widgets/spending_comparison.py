"""Spending-comparison dashboard widget service"""
import calendar
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.schemas.dashboard import RangeKind, SpendingComparisonResponse
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter

_MONTH_ABBREVIATIONS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


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
    labels, current_ranges, previous_ranges = _plan_spending_comparison(range_, now.date())

    if not accounts:
        return SpendingComparisonResponse(
            range=range_,
            slot_labels=labels,
            current=[0] * len(current_ranges),
            previous=[0] * len(previous_ranges),
            fx_status=FxStatus(),
        )

    accounts_by_id = {account.id: account for account in accounts}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    current_daily_spend = (
        await _query_daily_expense(
            db,
            accounts_by_id,
            base_currency,
            current_ranges[0][0],
            current_ranges[-1][1],
            converter,
        )
        if current_ranges
        else {}
    )
    previous_daily_spend = (
        await _query_daily_expense(
            db,
            accounts_by_id,
            base_currency,
            previous_ranges[0][0],
            previous_ranges[-1][1],
            converter,
        )
        if previous_ranges
        else {}
    )

    current_slot_totals = [
        _sum_days(current_daily_spend, date_range[0], date_range[1])
        for date_range in current_ranges
    ]
    previous_slot_totals = [
        _sum_days(previous_daily_spend, date_range[0], date_range[1])
        for date_range in previous_ranges
    ]

    return SpendingComparisonResponse(
        range=range_,
        slot_labels=labels,
        current=_cumulative_totals(current_slot_totals),
        previous=_cumulative_totals(previous_slot_totals),
        fx_status=converter.get_status(),
    )


def _plan_spending_comparison(
    range_: RangeKind, today: date,
) -> tuple[list[str], list[tuple[date, date]], list[tuple[date, date]]]:
    """Build labels and per-slot date ranges for a spending comparison period

    Args:
        range_: Calendar period requested by the dashboard
        today: Viewer-local current date

    Returns:
        Slot labels, current-period slot ranges, and previous-period slot ranges
    """
    if range_ == "WTD":
        # Full Monday-Sunday week drives the x-axis while current data fills up to today
        week_start = today - timedelta(days=today.weekday())
        labels = [(week_start + timedelta(days=index)).strftime("%a") for index in range(7)]
        elapsed_days = today.weekday() + 1
        current_ranges = [
            (week_start + timedelta(days=index), week_start + timedelta(days=index))
            for index in range(elapsed_days)
        ]
        previous_week_start = week_start - timedelta(days=7)
        previous_ranges = [
            (previous_week_start + timedelta(days=index), previous_week_start + timedelta(days=index))
            for index in range(7)
        ]
        return labels, current_ranges, previous_ranges

    if range_ == "MTD":
        return _plan_month_to_date_comparison(today)

    if range_ == "QTD":
        return _plan_quarter_to_date_comparison(today)

    return _plan_year_to_date_comparison(today)


def _plan_month_to_date_comparison(
    today: date,
) -> tuple[list[str], list[tuple[date, date]], list[tuple[date, date]]]:
    """Build labels and date ranges for month-to-date comparison

    Args:
        today: Viewer-local current date

    Returns:
        Day labels, current-month day ranges, and previous-month day ranges
    """
    month_days = calendar.monthrange(today.year, today.month)[1]
    labels = [str(index + 1) for index in range(month_days)]
    current_ranges = [
        (date(today.year, today.month, day), date(today.year, today.month, day))
        for day in range(1, today.day + 1)
    ]
    if today.month == 1:
        previous_year, previous_month = today.year - 1, 12
    else:
        previous_year, previous_month = today.year, today.month - 1
    previous_month_days = calendar.monthrange(previous_year, previous_month)[1]
    # Cap the prior-month days to the current month x-axis length
    previous_ranges = [
        (date(previous_year, previous_month, day), date(previous_year, previous_month, day))
        for day in range(1, min(previous_month_days, month_days) + 1)
    ]
    return labels, current_ranges, previous_ranges


def _plan_quarter_to_date_comparison(
    today: date,
) -> tuple[list[str], list[tuple[date, date]], list[tuple[date, date]]]:
    """Build labels and date ranges for quarter-to-date comparison

    Args:
        today: Viewer-local current date

    Returns:
        Week labels, current-quarter week ranges, and previous-quarter week ranges
    """
    quarter_month = ((today.month - 1) // 3) * 3 + 1
    current_quarter_start = date(today.year, quarter_month, 1)
    next_quarter_start = (
        date(today.year + 1, 1, 1) if quarter_month == 10
        else date(today.year, quarter_month + 3, 1)
    )
    days_in_quarter = (next_quarter_start - current_quarter_start).days
    week_count = (days_in_quarter + 6) // 7
    quarter_last_day = next_quarter_start - timedelta(days=1)
    labels = [f"W{index + 1}" for index in range(week_count)]
    current_weeks_elapsed = (today - current_quarter_start).days // 7 + 1
    current_ranges = []
    for index in range(current_weeks_elapsed):
        slot_start = current_quarter_start + timedelta(days=7 * index)
        slot_end = min(slot_start + timedelta(days=6), today, quarter_last_day)
        current_ranges.append((slot_start, slot_end))

    previous_quarter_start, previous_quarter_end = _previous_quarter_bounds(today.year, quarter_month)
    previous_days = (previous_quarter_end - previous_quarter_start).days + 1
    previous_week_count = (previous_days + 6) // 7
    previous_ranges = []
    for index in range(min(previous_week_count, week_count)):
        slot_start = previous_quarter_start + timedelta(days=7 * index)
        slot_end = min(slot_start + timedelta(days=6), previous_quarter_end)
        previous_ranges.append((slot_start, slot_end))
    return labels, current_ranges, previous_ranges


def _previous_quarter_bounds(year: int, quarter_month: int) -> tuple[date, date]:
    """Return the start and end dates for the previous quarter

    Args:
        year: Year containing the current quarter
        quarter_month: First month of the current quarter

    Returns:
        Previous quarter start and end dates
    """
    if quarter_month == 1:
        previous_year, previous_quarter_month = year - 1, 10
    else:
        previous_year, previous_quarter_month = year, quarter_month - 3
    previous_quarter_start = date(previous_year, previous_quarter_month, 1)
    previous_next_quarter_start = (
        date(previous_year + 1, 1, 1) if previous_quarter_month == 10
        else date(previous_year, previous_quarter_month + 3, 1)
    )
    return previous_quarter_start, previous_next_quarter_start - timedelta(days=1)


def _plan_year_to_date_comparison(
    today: date,
) -> tuple[list[str], list[tuple[date, date]], list[tuple[date, date]]]:
    """Build labels and date ranges for year-to-date comparison

    Args:
        today: Viewer-local current date

    Returns:
        Month labels, current-year month ranges, and previous-year month ranges
    """
    labels = list(_MONTH_ABBREVIATIONS)
    current_ranges = []
    for month in range(1, today.month + 1):
        start = date(today.year, month, 1)
        end = (
            today
            if month == today.month
            else date(today.year, month, calendar.monthrange(today.year, month)[1])
        )
        current_ranges.append((start, end))
    previous_year = today.year - 1
    previous_ranges = [
        (
            date(previous_year, month, 1),
            date(previous_year, month, calendar.monthrange(previous_year, month)[1]),
        )
        for month in range(1, 13)
    ]
    return labels, current_ranges, previous_ranges


async def _query_daily_expense(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
    converter: FxConverter,
) -> dict[date, int]:
    """Return positive daily expense totals for a date range

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive start date
        end: Inclusive end date
        converter: Request-scoped FX converter

    Returns:
        Positive expense totals keyed by transaction date
    """
    result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(list(accounts_by_id)),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id),
    )
    rows = list(result)
    for currency in sorted({
        accounts_by_id[row.account_id].currency
        for row in rows
        if accounts_by_id[row.account_id].currency != base_currency
    }):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )

    daily_expenses: dict[date, int] = {}
    for row in rows:
        # Transaction.amount uses the account currency, while Transaction.currency is receipt metadata
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=accounts_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.dt,
        )
        if converted_total is None:
            continue

        daily_expenses[row.dt] = daily_expenses.get(row.dt, 0) - converted_total
    return daily_expenses


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


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in currency_result}
