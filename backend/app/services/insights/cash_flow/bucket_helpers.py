"""Helpers for building cash-flow bucket ranges and rows"""

from datetime import date, timedelta
from typing import Literal

CashFlowGranularity = Literal["day", "week", "month"]
CashFlowBucket = tuple[date, date]
CashFlowBucketRow = tuple[date, date, int, int]
DailyCashFlowTotalsByDate = dict[date, tuple[int, int]]

_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


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


def _get_cash_flow_bucket_key(target: date, granularity: CashFlowGranularity) -> tuple[int, ...]:
    """Return the grouping key for a cash-flow bucket date

    Args:
        target: Date being assigned to a bucket
        granularity: Bucket granularity used for the selected range

    Returns:
        Tuple key representing the target date bucket
    """
    if granularity == "day":
        bucket_key = (target.year, target.month, target.day)
    elif granularity == "week":
        iso_year, iso_week, _weekday = target.isocalendar()
        bucket_key = (iso_year, iso_week)
    else:
        bucket_key = (target.year, target.month)
    return bucket_key


def get_cash_flow_buckets(from_date: date, to_date: date) -> list[CashFlowBucket]:
    """Return inclusive cash-flow bucket ranges for the selected date range

    Args:
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Inclusive bucket start and end dates for the response rows
    """
    granularity = _get_cash_flow_granularity(from_date, to_date)
    buckets: list[CashFlowBucket] = []
    bucket_start = from_date
    current_key = _get_cash_flow_bucket_key(from_date, granularity)
    cursor = from_date

    # Walk the range and close a bucket when the granularity key changes
    while cursor <= to_date:
        bucket_key = _get_cash_flow_bucket_key(cursor, granularity)
        if bucket_key != current_key:
            buckets.append((bucket_start, cursor - timedelta(days=1)))
            bucket_start = cursor
            current_key = bucket_key
        cursor += timedelta(days=1)

    buckets.append((bucket_start, to_date))
    return buckets


def get_cash_flow_bucket_rows(
    buckets: list[CashFlowBucket],
    daily_totals: DailyCashFlowTotalsByDate,
) -> list[CashFlowBucketRow]:
    """Return cash-flow response rows for bucket ranges

    Args:
        buckets: Inclusive bucket ranges used by the response
        daily_totals: Daily inflow and outflow totals keyed by date

    Returns:
        Cash-flow bucket rows containing date range, inflow, and outflow
    """
    cash_flow_rows: list[CashFlowBucketRow] = []

    # Sum daily totals into each bucket so the response granularity matches the selected range
    for bucket_start, bucket_end in buckets:
        inflow = 0
        outflow = 0
        cursor = bucket_start
        while cursor <= bucket_end:
            day_inflow, day_outflow = daily_totals.get(cursor, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            cursor += timedelta(days=1)
        cash_flow_rows.append((bucket_start, bucket_end, inflow, outflow))
    return cash_flow_rows
