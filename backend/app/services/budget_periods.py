"""Pure date-math functions for budget instance period alignment and computation.

No DB access, no HTTP — stdlib only. Used by the base_budget and budget routes
to validate user-provided `period_start` and derive `period_end` from the parent
base's cadence settings.
"""
import calendar
from datetime import date, timedelta

from app.models.base import RecurrenceFreq


def validate_period_start(
    period_start: date,
    freq: RecurrenceFreq,
    *,
    weekday: int | None = None,
    dom: int | None = None,
    month: int | None = None,
) -> str | None:
    """Check that period_start aligns with the base's cadence.

    Returns None on success, or a human-readable error string on failure.
    """
    if freq == RecurrenceFreq.WEEKLY:
        if period_start.weekday() != weekday:
            day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            return f"Weekly budgets must start on {day_names[weekday]}"
        return None

    if freq == RecurrenceFreq.MONTHLY:
        expected_day = _anchor_day(period_start.year, period_start.month, dom)
        if period_start.day != expected_day:
            return f"Monthly budgets must start on day {dom} of the month (or the last day if the month is shorter)"
        return None

    if freq == RecurrenceFreq.YEARLY:
        expected_day = _anchor_day(period_start.year, month, dom)
        if period_start.month != month or period_start.day != expected_day:
            return f"Yearly budgets must start on month {month}, day {dom} (or the last day if the month is shorter)"
        return None

    return f"Unknown recurrence frequency: {freq}"


def compute_period_end(
    period_start: date,
    freq: RecurrenceFreq,
    instance_length: int,
    *,
    dom: int | None = None,
    month: int | None = None,
) -> date:
    """Derive the inclusive period_end from a validated period_start.

    The end date is always `next_anchor - 1 day`, where next_anchor is the
    start of the hypothetical next instance under the same cadence.
    """
    if freq == RecurrenceFreq.WEEKLY:
        return period_start + timedelta(days=7 * instance_length - 1)

    if freq == RecurrenceFreq.MONTHLY:
        next_anchor = _add_months_anchored(period_start, instance_length, dom)
        return next_anchor - timedelta(days=1)

    if freq == RecurrenceFreq.YEARLY:
        next_year = period_start.year + instance_length
        next_anchor_day = _anchor_day(next_year, month, dom)
        return date(next_year, month, next_anchor_day) - timedelta(days=1)

    msg = f"Unknown recurrence frequency: {freq}"
    raise ValueError(msg)


def _anchor_day(year: int, month: int, dom: int) -> int:
    """Return the actual anchor day for a (year, month, dom) triple.

    If dom exceeds the month's length (e.g. dom=31 in a 30-day month),
    falls back to the last day of the month.
    """
    last_day = calendar.monthrange(year, month)[1]
    return min(dom, last_day)


def _add_months_anchored(start: date, months: int, dom: int) -> date:
    """Advance by `months` calendar months, snapping to `dom` (or last day)."""
    total_months = (start.year * 12 + start.month - 1) + months
    year = total_months // 12
    month = total_months % 12 + 1
    day = _anchor_day(year, month, dom)
    return date(year, month, day)
