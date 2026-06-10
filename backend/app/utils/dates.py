"""Date utilities"""
from datetime import date, datetime


def get_month_start_date(reference: date | datetime) -> date:
    """Return the first day of the month containing a date-like value

    Args:
        reference: Date or datetime used to choose the month

    Returns:
        First day of the reference month
    """
    return date(reference.year, reference.month, 1)


def get_shifted_month_start_date(reference: date | datetime, month_offset: int) -> date:
    """Return the month start offset by a number of calendar months

    Args:
        reference: Date or datetime used as the starting month
        month_offset: Number of months to move forward or backward

    Returns:
        First day of the target month
    """
    start = get_month_start_date(reference)
    month_index = (start.year * 12) + (start.month - 1) + month_offset
    return date(month_index // 12, (month_index % 12) + 1, 1)


def get_next_month_start_date(reference: date | datetime) -> date:
    """Return the first day of the month immediately after a date-like value

    Args:
        reference: Date or datetime used to choose the current month

    Returns:
        First day of the next calendar month
    """
    return get_shifted_month_start_date(reference, 1)


def get_month_start_dates(start_month: date | datetime, count: int) -> list[date]:
    """Return ordered month starts beginning at a month anchor

    Args:
        start_month: Month anchor used as the first emitted month
        count: Number of month starts to emit

    Returns:
        Ordered first-of-month dates
    """
    if count <= 0:
        return []

    start = get_month_start_date(start_month)
    return [get_shifted_month_start_date(start, offset) for offset in range(count)]


def get_recent_month_start_dates(reference: date | datetime, count: int) -> list[date]:
    """Return ordered month starts ending with the reference month

    Args:
        reference: Date or datetime used to choose the final emitted month
        count: Number of month starts to emit

    Returns:
        Oldest-first first-of-month dates ending with the reference month
    """
    if count <= 0:
        return []

    final_month = get_month_start_date(reference)
    start_month = get_shifted_month_start_date(final_month, -(count - 1))
    return get_month_start_dates(start_month, count)
