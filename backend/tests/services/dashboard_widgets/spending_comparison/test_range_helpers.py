import calendar
from datetime import date, timedelta

from hypothesis import given
from hypothesis import strategies as st

from app.services.dashboard_widgets.spending_comparison.range_helpers import get_spending_comparison_slot_ranges

_TODAY_DATES = st.dates(min_value=date(2001, 1, 1), max_value=date(2099, 12, 31))


def _assert_ranges_are_contiguous(ranges):
    """Assert date ranges are ordered without gaps"""
    for index, (start_date, end_date) in enumerate(ranges):
        assert start_date <= end_date
        if index == 0:
            continue

        previous_end_date = ranges[index - 1][1]
        assert start_date == previous_end_date + timedelta(days=1)


def _get_quarter_start(today):
    """Return the first day of the quarter containing today"""
    quarter_month = ((today.month - 1) // 3) * 3 + 1
    return date(today.year, quarter_month, 1)


def _get_next_quarter_start(quarter_start):
    """Return the first day after the quarter"""
    if quarter_start.month == 10:
        return date(quarter_start.year + 1, 1, 1)

    return date(quarter_start.year, quarter_start.month + 3, 1)


def _get_previous_quarter_start(quarter_start):
    """Return the first day of the previous quarter"""
    if quarter_start.month == 1:
        return date(quarter_start.year - 1, 10, 1)

    return date(quarter_start.year, quarter_start.month - 3, 1)


def _get_previous_month_start(today):
    """Return the first day of the month before today"""
    if today.month == 1:
        return date(today.year - 1, 12, 1)

    return date(today.year, today.month - 1, 1)


def test_get_spending_comparison_slot_ranges_returns_week_to_date_slots():
    """Week-to-date slots use the current Monday through today and the full previous week"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("WTD", date(2026, 6, 10))

    assert labels == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    assert current_ranges == [
        (date(2026, 6, 8), date(2026, 6, 8)),
        (date(2026, 6, 9), date(2026, 6, 9)),
        (date(2026, 6, 10), date(2026, 6, 10)),
    ]
    assert previous_ranges == [
        (date(2026, 6, 1), date(2026, 6, 1)),
        (date(2026, 6, 2), date(2026, 6, 2)),
        (date(2026, 6, 3), date(2026, 6, 3)),
        (date(2026, 6, 4), date(2026, 6, 4)),
        (date(2026, 6, 5), date(2026, 6, 5)),
        (date(2026, 6, 6), date(2026, 6, 6)),
        (date(2026, 6, 7), date(2026, 6, 7)),
    ]


def test_get_spending_comparison_slot_ranges_caps_previous_month_to_current_axis():
    """Month-to-date labels follow the current month while previous slots stop at the shorter month"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("MTD", date(2026, 3, 31))

    assert labels[0] == "1"
    assert labels[-1] == "31"
    assert len(labels) == 31
    assert current_ranges[0] == (date(2026, 3, 1), date(2026, 3, 1))
    assert current_ranges[-1] == (date(2026, 3, 31), date(2026, 3, 31))
    assert previous_ranges[0] == (date(2026, 2, 1), date(2026, 2, 1))
    assert previous_ranges[-1] == (date(2026, 2, 28), date(2026, 2, 28))
    assert len(previous_ranges) == 28


def test_get_spending_comparison_slot_ranges_handles_quarter_to_date_year_boundary():
    """Quarter-to-date slots mirror the previous quarter across the year boundary"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("QTD", date(2026, 1, 12))

    assert labels == [f"W{index}" for index in range(1, 14)]
    assert current_ranges == [
        (date(2026, 1, 1), date(2026, 1, 7)),
        (date(2026, 1, 8), date(2026, 1, 12)),
    ]
    assert previous_ranges[0] == (date(2025, 10, 1), date(2025, 10, 7))
    assert previous_ranges[-1] == (date(2025, 12, 24), date(2025, 12, 30))
    assert len(previous_ranges) == 13


def test_get_spending_comparison_slot_ranges_returns_year_to_date_month_slots():
    """Year-to-date slots include elapsed current-year months and every previous-year month"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("YTD", date(2026, 4, 15))

    assert labels == ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    assert current_ranges == [
        (date(2026, 1, 1), date(2026, 1, 31)),
        (date(2026, 2, 1), date(2026, 2, 28)),
        (date(2026, 3, 1), date(2026, 3, 31)),
        (date(2026, 4, 1), date(2026, 4, 15)),
    ]
    assert previous_ranges[0] == (date(2025, 1, 1), date(2025, 1, 31))
    assert previous_ranges[-1] == (date(2025, 12, 1), date(2025, 12, 31))
    assert len(previous_ranges) == 12


@given(today=_TODAY_DATES)
def test_get_spending_comparison_slot_ranges_keeps_week_to_date_ranges_consistent(today):
    """Week-to-date slots stay contiguous and bounded for generated dates"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("WTD", today)

    week_start = today - timedelta(days=today.weekday())
    previous_week_start = week_start - timedelta(days=7)

    assert labels == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    assert len(current_ranges) == today.weekday() + 1
    assert current_ranges[0] == (week_start, week_start)
    assert current_ranges[-1] == (today, today)
    assert previous_ranges[0] == (previous_week_start, previous_week_start)
    assert previous_ranges[-1] == (week_start - timedelta(days=1), week_start - timedelta(days=1))
    assert len(previous_ranges) == 7
    _assert_ranges_are_contiguous(current_ranges)
    _assert_ranges_are_contiguous(previous_ranges)


@given(today=_TODAY_DATES)
def test_get_spending_comparison_slot_ranges_keeps_month_to_date_ranges_consistent(today):
    """Month-to-date slots stay contiguous and bounded for generated dates"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("MTD", today)

    month_days = calendar.monthrange(today.year, today.month)[1]
    previous_month_start = _get_previous_month_start(today)
    previous_month_days = calendar.monthrange(previous_month_start.year, previous_month_start.month)[1]
    expected_previous_day_count = min(previous_month_days, month_days)

    assert labels == [str(day) for day in range(1, month_days + 1)]
    assert len(current_ranges) == today.day
    assert current_ranges[0] == (date(today.year, today.month, 1), date(today.year, today.month, 1))
    assert current_ranges[-1] == (today, today)
    assert len(previous_ranges) == expected_previous_day_count
    assert previous_ranges[0] == (previous_month_start, previous_month_start)
    assert previous_ranges[-1] == (
        previous_month_start + timedelta(days=expected_previous_day_count - 1),
        previous_month_start + timedelta(days=expected_previous_day_count - 1),
    )
    _assert_ranges_are_contiguous(current_ranges)
    _assert_ranges_are_contiguous(previous_ranges)


@given(today=_TODAY_DATES)
def test_get_spending_comparison_slot_ranges_keeps_quarter_to_date_ranges_consistent(today):
    """Quarter-to-date slots stay contiguous and bounded for generated dates"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("QTD", today)

    quarter_start = _get_quarter_start(today)
    next_quarter_start = _get_next_quarter_start(quarter_start)
    quarter_days = (next_quarter_start - quarter_start).days
    expected_week_count = (quarter_days + 6) // 7
    expected_elapsed_weeks = (today - quarter_start).days // 7 + 1
    previous_quarter_start = _get_previous_quarter_start(quarter_start)
    previous_quarter_end = quarter_start - timedelta(days=1)

    assert labels == [f"W{index}" for index in range(1, expected_week_count + 1)]
    assert len(current_ranges) == expected_elapsed_weeks
    assert current_ranges[0][0] == quarter_start
    assert current_ranges[-1][1] == today
    assert previous_ranges[0][0] == previous_quarter_start
    assert previous_ranges[-1][1] <= previous_quarter_end
    assert len(previous_ranges) <= len(labels)
    assert all((end_date - start_date).days <= 6 for start_date, end_date in current_ranges)
    assert all((end_date - start_date).days <= 6 for start_date, end_date in previous_ranges)
    _assert_ranges_are_contiguous(current_ranges)
    _assert_ranges_are_contiguous(previous_ranges)


@given(today=_TODAY_DATES)
def test_get_spending_comparison_slot_ranges_keeps_year_to_date_ranges_consistent(today):
    """Year-to-date slots stay contiguous and bounded for generated dates"""
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges("YTD", today)

    previous_year = today.year - 1

    assert labels == ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    assert len(current_ranges) == today.month
    assert current_ranges[0][0] == date(today.year, 1, 1)
    assert current_ranges[-1][1] == today
    assert len(previous_ranges) == 12
    assert previous_ranges[0] == (date(previous_year, 1, 1), date(previous_year, 1, 31))
    assert previous_ranges[-1] == (date(previous_year, 12, 1), date(previous_year, 12, 31))
    _assert_ranges_are_contiguous(current_ranges)
    _assert_ranges_are_contiguous(previous_ranges)
