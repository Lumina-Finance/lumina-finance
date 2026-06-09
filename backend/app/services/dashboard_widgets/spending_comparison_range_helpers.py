"""Spending comparison range helpers"""

import calendar
from datetime import date, timedelta

from app.schemas.dashboard import RangeKind

type DateSlotRange = tuple[date, date]
type SpendingComparisonSlotRanges = tuple[list[str], list[DateSlotRange], list[DateSlotRange]]

_MONTH_ABBREVIATIONS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]


def get_spending_comparison_slot_ranges(range_: RangeKind, today: date) -> SpendingComparisonSlotRanges:
    """Return labels and date ranges for a spending comparison period

    Args:
        range_: Calendar period requested by the dashboard
        today: Viewer-local current date

    Returns:
        Slot labels, current-period slot ranges, and previous-period slot ranges
    """
    if range_ == "WTD":
        return _get_week_to_date_slot_ranges(today)

    if range_ == "MTD":
        return _get_month_to_date_slot_ranges(today)

    if range_ == "QTD":
        return _get_quarter_to_date_slot_ranges(today)

    return _get_year_to_date_slot_ranges(today)


def _get_week_to_date_slot_ranges(today: date) -> SpendingComparisonSlotRanges:
    """Return labels and date ranges for week-to-date comparison

    Args:
        today: Viewer-local current date

    Returns:
        Weekday labels, current-week day ranges, and previous-week day ranges
    """
    week_start = today - timedelta(days=today.weekday())

    # Keep the full Monday-Sunday week on the x-axis while current values stop at today
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


def _get_month_to_date_slot_ranges(today: date) -> SpendingComparisonSlotRanges:
    """Return labels and date ranges for month-to-date comparison

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
    previous_year, previous_month = _get_previous_month(today)
    previous_month_days = calendar.monthrange(previous_year, previous_month)[1]

    # Cap the prior-month days to the current month x-axis length
    previous_ranges = [
        (date(previous_year, previous_month, day), date(previous_year, previous_month, day))
        for day in range(1, min(previous_month_days, month_days) + 1)
    ]
    return labels, current_ranges, previous_ranges


def _get_previous_month(today: date) -> tuple[int, int]:
    """Return the year and month immediately before the current month

    Args:
        today: Viewer-local current date

    Returns:
        Previous year and month number
    """
    if today.month == 1:
        previous_year = today.year - 1
        previous_month = 12
    else:
        previous_year = today.year
        previous_month = today.month - 1

    return previous_year, previous_month


def _get_quarter_to_date_slot_ranges(today: date) -> SpendingComparisonSlotRanges:
    """Return labels and date ranges for quarter-to-date comparison

    Args:
        today: Viewer-local current date

    Returns:
        Week labels, current-quarter week ranges, and previous-quarter week ranges
    """
    quarter_month = ((today.month - 1) // 3) * 3 + 1
    current_quarter_start = date(today.year, quarter_month, 1)
    next_quarter_start = (
        date(today.year + 1, 1, 1)
        if quarter_month == 10
        else date(today.year, quarter_month + 3, 1)
    )
    days_in_quarter = (next_quarter_start - current_quarter_start).days
    week_count = (days_in_quarter + 6) // 7
    quarter_last_day = next_quarter_start - timedelta(days=1)
    labels = [f"W{index + 1}" for index in range(week_count)]
    current_weeks_elapsed = (today - current_quarter_start).days // 7 + 1
    current_ranges = []

    # Split the elapsed quarter into week-sized slots and cap the final slot at today
    for index in range(current_weeks_elapsed):
        slot_start = current_quarter_start + timedelta(days=7 * index)
        slot_end = min(slot_start + timedelta(days=6), today, quarter_last_day)
        current_ranges.append((slot_start, slot_end))

    previous_quarter_start, previous_quarter_end = _get_previous_quarter_bounds(today.year, quarter_month)
    previous_days = (previous_quarter_end - previous_quarter_start).days + 1
    previous_week_count = (previous_days + 6) // 7
    previous_ranges = []

    # Mirror the current quarter x-axis against the previous quarter without exceeding its last day
    for index in range(min(previous_week_count, week_count)):
        slot_start = previous_quarter_start + timedelta(days=7 * index)
        slot_end = min(slot_start + timedelta(days=6), previous_quarter_end)
        previous_ranges.append((slot_start, slot_end))
    return labels, current_ranges, previous_ranges


def _get_previous_quarter_bounds(year: int, quarter_month: int) -> DateSlotRange:
    """Return the start and end dates for the previous quarter

    Args:
        year: Year containing the current quarter
        quarter_month: First month of the current quarter

    Returns:
        Previous quarter start and end dates
    """
    if quarter_month == 1:
        previous_year = year - 1
        previous_quarter_month = 10
    else:
        previous_year = year
        previous_quarter_month = quarter_month - 3

    previous_quarter_start = date(previous_year, previous_quarter_month, 1)
    previous_next_quarter_start = (
        date(previous_year + 1, 1, 1)
        if previous_quarter_month == 10
        else date(previous_year, previous_quarter_month + 3, 1)
    )
    previous_quarter_end = previous_next_quarter_start - timedelta(days=1)
    return previous_quarter_start, previous_quarter_end


def _get_year_to_date_slot_ranges(today: date) -> SpendingComparisonSlotRanges:
    """Return labels and date ranges for year-to-date comparison

    Args:
        today: Viewer-local current date

    Returns:
        Month labels, current-year month ranges, and previous-year month ranges
    """
    labels = list(_MONTH_ABBREVIATIONS)
    current_ranges = []

    # Current-year slots stop at today while previous-year slots cover full months
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
