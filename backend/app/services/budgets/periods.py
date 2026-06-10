"""Budget period alignment and end-date calculations

These helpers do not use the database or HTTP. Budget routes use them to
validate submitted period starts and derive period ends from base budget cadence
settings
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
    """Return a validation message when a period start breaks cadence rules

    Args:
        period_start: Proposed budget period start date
        freq: Budget recurrence frequency
        weekday: Required weekday for weekly budgets
        dom: Required day of month for monthly and yearly budgets
        month: Required month for yearly budgets

    Returns:
        None when the period start is valid, otherwise a client-facing validation message
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
    """Return the inclusive period end for a validated budget period

    The end date is the day before the next cadence anchor for the same base budget

    Args:
        period_start: Validated budget period start date
        freq: Budget recurrence frequency
        instance_length: Number of cadence units covered by the instance
        dom: Required day of month for monthly and yearly budgets
        month: Required month for yearly budgets

    Returns:
        Inclusive budget period end date

    Raises:
        ValueError: Recurrence frequency is unknown
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
    """Return the valid calendar day for a configured day-of-month anchor

    Args:
        year: Calendar year containing the anchor
        month: Calendar month containing the anchor
        dom: Configured day of month

    Returns:
        Configured day of month, capped to the month's last valid day
    """
    last_day = calendar.monthrange(year, month)[1]
    return min(dom, last_day)


def _add_months_anchored(start: date, months: int, dom: int) -> date:
    """Return a month-shifted date using the configured day-of-month anchor

    Args:
        start: Starting date
        months: Number of months to advance
        dom: Configured day of month

    Returns:
        Shifted date capped to the target month's last valid day
    """
    total_months = (start.year * 12 + start.month - 1) + months
    year = total_months // 12
    month = total_months % 12 + 1
    day = _anchor_day(year, month, dom)
    return date(year, month, day)
