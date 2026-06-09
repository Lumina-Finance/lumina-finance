"""Bucket date helpers for the insights net worth card"""

from datetime import date, timedelta
from typing import Literal

NetWorthGranularity = Literal["day", "week", "month"]

_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


def build_net_worth_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    """Return label and value dates for net worth chart buckets

    Args:
        from_date: Inclusive chart start date
        to_date: Inclusive chart end date

    Returns:
        Bucket label dates and value dates using account-detail semantics
    """
    granularity = _get_granularity(from_date, to_date)
    buckets: list[tuple[date, date]] = []
    cursor = _get_bucket_start(from_date, granularity)
    while cursor <= to_date:
        next_start = _get_next_bucket_start(cursor, granularity)
        value_date = min(next_start - timedelta(days=1), to_date)
        buckets.append((cursor, value_date))
        cursor = next_start
    return buckets


def _get_granularity(from_date: date, to_date: date) -> NetWorthGranularity:
    """Return the insights net worth chart bucket cadence

    Args:
        from_date: Inclusive chart start date
        to_date: Inclusive chart end date

    Returns:
        Bucket granularity for the requested date range
    """
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _get_bucket_start(target: date, granularity: NetWorthGranularity) -> date:
    """Return the bucket start date containing a target date

    Args:
        target: Date to place inside a bucket
        granularity: Bucket cadence used by the chart

    Returns:
        Start date for the bucket containing the target date
    """
    if granularity == "day":
        return target
    if granularity == "week":
        return target - timedelta(days=target.weekday())
    return date(target.year, target.month, 1)


def _get_next_bucket_start(target: date, granularity: NetWorthGranularity) -> date:
    """Return the start date for the bucket after the target bucket

    Args:
        target: Current bucket start date
        granularity: Bucket cadence used by the chart

    Returns:
        Start date for the next bucket
    """
    if granularity == "day":
        return target + timedelta(days=1)
    if granularity == "week":
        return target + timedelta(days=7)
    if target.month == 12:
        return date(target.year + 1, 1, 1)
    return date(target.year, target.month + 1, 1)
