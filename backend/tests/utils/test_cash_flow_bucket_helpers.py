"""Cash-flow bucket tests: the stepped buckets match the day-by-day walk they replaced"""

from datetime import date, timedelta

import pytest

from app.utils.cash_flow_bucket_helpers import get_cash_flow_bucket_rows, get_cash_flow_buckets


def _walk_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    """Return the buckets by visiting every day and closing one when its key changes, as the code once did"""
    day_count = (to_date - from_date).days + 1
    if day_count <= 31:

        def key(target: date) -> tuple[int, ...]:
            return (target.year, target.month, target.day)
    elif day_count <= 183:

        def key(target: date) -> tuple[int, ...]:
            return target.isocalendar()[:2]
    else:

        def key(target: date) -> tuple[int, ...]:
            return (target.year, target.month)

    buckets = []
    bucket_start = from_date
    current_key = key(from_date)
    cursor = from_date
    while cursor <= to_date:
        if key(cursor) != current_key:
            buckets.append((bucket_start, cursor - timedelta(days=1)))
            bucket_start = cursor
            current_key = key(cursor)
        cursor += timedelta(days=1)
    buckets.append((bucket_start, to_date))
    return buckets


def _walk_rows(buckets: list[tuple[date, date]], totals: dict[date, tuple[int, int]]) -> list[tuple[date, date, int, int]]:
    """Return the rows by summing every day of each bucket, as the code once did"""
    rows = []
    for start, end in buckets:
        inflow = outflow = 0
        cursor = start
        while cursor <= end:
            day_inflow, day_outflow = totals.get(cursor, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            cursor += timedelta(days=1)
        rows.append((start, end, inflow, outflow))
    return rows


RANGES = [
    pytest.param(date(2026, 3, 5), date(2026, 3, 5), id="one-day"),
    pytest.param(date(2026, 3, 1), date(2026, 3, 31), id="31-days-by-day"),
    pytest.param(date(2026, 3, 1), date(2026, 4, 1), id="32-days-by-week"),
    pytest.param(date(2026, 3, 4), date(2026, 8, 31), id="by-week-from-midweek"),
    pytest.param(date(2025, 12, 29), date(2026, 5, 20), id="iso-week-across-new-year"),
    pytest.param(date(2020, 12, 28), date(2021, 6, 1), id="53-week-year"),
    pytest.param(date(2026, 1, 1), date(2026, 7, 2), id="183-days-by-week"),
    pytest.param(date(2026, 1, 1), date(2026, 7, 3), id="184-days-by-month"),
    pytest.param(date(2024, 1, 15), date(2025, 3, 3), id="by-month-across-leap-year"),
    pytest.param(date(2023, 11, 20), date(2024, 2, 29), id="ends-on-leap-day"),
    pytest.param(date(1900, 1, 1), date(1919, 12, 31), id="20-years-from-1900"),
]


@pytest.mark.parametrize(("from_date", "to_date"), RANGES)
def test_buckets_match_the_day_by_day_walk(from_date, to_date):
    """Each range is cut into the same buckets as a walk over every day gave"""
    assert get_cash_flow_buckets(from_date, to_date) == _walk_buckets(from_date, to_date)


@pytest.mark.parametrize(("from_date", "to_date"), RANGES)
def test_rows_match_the_day_by_day_sums(from_date, to_date):
    """Totals land in the same buckets, and days outside the range or with no total change nothing"""
    totals = {
        from_date - timedelta(days=1): (900, 900),
        from_date: (100, 10),
        from_date + timedelta(days=3): (200, 20),
        to_date: (300, 30),
        to_date + timedelta(days=1): (800, 800),
    }
    for offset in range(0, (to_date - from_date).days, 17):
        totals.setdefault(from_date + timedelta(days=offset), (offset + 1, offset + 2))
    buckets = get_cash_flow_buckets(from_date, to_date)

    assert get_cash_flow_bucket_rows(buckets, totals) == _walk_rows(buckets, totals)


def test_a_range_of_twenty_years_is_cut_without_visiting_each_day(monkeypatch):
    """Cutting 20 years into months asks for the next bucket once per bucket (240 times), not 7,300 times"""
    from app.utils import cash_flow_bucket_helpers

    calls = 0
    original = cash_flow_bucket_helpers._get_next_bucket_start

    def counting(current, granularity):
        nonlocal calls
        calls += 1
        return original(current, granularity)

    monkeypatch.setattr(cash_flow_bucket_helpers, "_get_next_bucket_start", counting)

    buckets = get_cash_flow_buckets(date(2000, 1, 1), date(2019, 12, 31))

    assert len(buckets) == 240
    assert calls == 240
