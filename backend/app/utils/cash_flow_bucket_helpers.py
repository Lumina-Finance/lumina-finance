"""Cash-flow bucket helpers"""

from bisect import bisect_left, bisect_right
from collections.abc import Mapping
from datetime import date, timedelta
from typing import Literal

CashFlowGranularity = Literal["day", "week", "month"]
CashFlowBucket = tuple[date, date]
CashFlowBucketRow = tuple[date, date, int, int]
CashFlowDailyTotalsByDate = Mapping[date, tuple[int, int]]

_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


def get_cash_flow_buckets(from_date: date, to_date: date) -> list[CashFlowBucket]:
    """Return inclusive cash-flow bucket ranges for a date range

    Args:
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Inclusive bucket start and end dates for response rows
    """
    granularity = _get_cash_flow_granularity(from_date, to_date)
    buckets: list[CashFlowBucket] = []
    bucket_start = from_date

    # Step from one bucket to the next, so the work follows the bucket count and not the days in the range
    while bucket_start <= to_date:
        next_start = _get_next_bucket_start(bucket_start, granularity)
        buckets.append((bucket_start, min(next_start - timedelta(days=1), to_date)))
        bucket_start = next_start

    return buckets


def get_cash_flow_bucket_rows(
    buckets: list[CashFlowBucket],
    daily_totals: CashFlowDailyTotalsByDate,
) -> list[CashFlowBucketRow]:
    """Return cash-flow rows for bucket ranges

    Args:
        buckets: Inclusive bucket ranges used by the response
        daily_totals: Daily inflow and outflow totals keyed by date

    Returns:
        Cash-flow bucket rows containing date range, inflow, and outflow
    """
    cash_flow_rows: list[CashFlowBucketRow] = []
    dates_with_totals = sorted(daily_totals)

    # Sum the days that have totals into each bucket so response granularity matches the selected range
    for bucket_start, bucket_end in buckets:
        inflow = 0
        outflow = 0
        first = bisect_left(dates_with_totals, bucket_start)
        last = bisect_right(dates_with_totals, bucket_end)
        for day in dates_with_totals[first:last]:
            day_inflow, day_outflow = daily_totals[day]
            inflow += day_inflow
            outflow += day_outflow
        bucket_row = (bucket_start, bucket_end, inflow, outflow)
        cash_flow_rows.append(bucket_row)
    return cash_flow_rows


def _get_cash_flow_granularity(from_date: date, to_date: date) -> CashFlowGranularity:
    """Return the bucket granularity for a cash-flow date range

    Args:
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Bucket granularity used for the response rows
    """
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _get_next_bucket_start(current: date, granularity: CashFlowGranularity) -> date:
    """Return the first date of the bucket after the one holding a date

    Args:
        current: Date inside the bucket being closed
        granularity: Bucket granularity used for the selected range

    Returns:
        The next day, the next ISO Monday or the first of the next month
    """
    if granularity == "day":
        next_start = current + timedelta(days=1)
    elif granularity == "week":
        next_start = current + timedelta(days=7 - current.weekday())
    elif current.month == 12:
        next_start = date(current.year + 1, 1, 1)
    else:
        next_start = date(current.year, current.month + 1, 1)
    return next_start
