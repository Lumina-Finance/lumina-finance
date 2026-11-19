"""Date window tests: where the window ends and which report ranges are refused"""

import calendar
from datetime import UTC, date, datetime

import pytest
from fastapi import HTTPException
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.utils import date_window
from app.utils.date_window import get_latest_allowed_date, get_window_error, require_report_range
from tests.routes.support.generators import date_ranges, date_ranges_near_span

# 23:30 UTC on 9 June is already 10 June in the furthest-ahead timezone, so a window counted from
# the UTC date would end a day early for a user there
LATE_EVENING_UTC = datetime(2026, 6, 9, 23, 30, tzinfo=UTC)

# The two ends of the window under that clock, written out so the property draws from the whole of it
EARLIEST_ALLOWED = date(1900, 1, 1)
LATEST_ALLOWED = date(2036, 6, 10)


@pytest.fixture(autouse=True)
def frozen_clock(freeze_now) -> None:
    """Fix the moment the window is counted from"""
    freeze_now(date_window, LATE_EVENING_UTC)


def test_the_window_ends_ten_years_after_the_latest_calendar_today():
    """A user ahead of UTC can still pick the day ten years after their own today"""
    assert get_latest_allowed_date() == date(2036, 6, 10)


def test_the_window_ends_on_28_february_when_ten_years_after_29_february_has_no_such_day(freeze_now):
    """Ten years after 29 February 2028, the day the furthest-ahead calendar is on, falls on 28 February"""
    freeze_now(date_window, datetime(2028, 2, 28, 12, 0, tzinfo=UTC))

    assert get_latest_allowed_date() == date(2038, 2, 28)
    assert get_window_error(date(2038, 2, 28)) is None
    assert get_window_error(date(2038, 3, 1)) == "must be within ten years of today"


@pytest.mark.parametrize(
    ("value", "error"),
    [
        (date(1900, 1, 1), None),
        (date(1899, 12, 31), "must be on or after 1 January 1900"),
        (date(2036, 6, 10), None),
        (date(2036, 6, 11), "must be within ten years of today"),
    ],
)
def test_window_error_names_the_edge_a_date_is_past(value, error):
    """Each edge of the window is inside it, and the day beyond it is refused with that edge's reason"""
    assert get_window_error(value) == error


@pytest.mark.parametrize(
    ("from_date", "to_date"),
    [
        (date(2010, 1, 1), date(2029, 12, 31)),
        (date(2016, 2, 29), date(2036, 2, 28)),
        (date(2016, 6, 11), date(2036, 6, 10)),
    ],
)
def test_report_range_accepts_up_to_20_years_inside_the_window(from_date, to_date):
    """A range one day short of 20 years is allowed, including one that starts on 29 February"""
    require_report_range(from_date, to_date)


@pytest.mark.parametrize(
    ("from_date", "to_date", "detail"),
    [
        (date(2010, 1, 1), date(2030, 1, 1), "Range can cover at most 20 years"),
        (date(2016, 2, 29), date(2036, 2, 29), "Range can cover at most 20 years"),
        (date(1899, 12, 31), date(1900, 1, 5), "Start date must be on or after 1 January 1900"),
        (date(2030, 1, 1), date(2036, 6, 11), "End date must be within ten years of today"),
        (date(2036, 6, 11), date(2036, 6, 12), "Start date must be within ten years of today"),
        (date(2020, 1, 2), date(2020, 1, 1), "Start date must be before end date"),
    ],
)
def test_report_range_refuses_each_case_with_a_message_naming_the_field(from_date, to_date, detail):
    """A range past 20 years, outside the window at either end, or reversed is refused as a 422"""
    with pytest.raises(HTTPException) as refusal:
        require_report_range(from_date, to_date)

    assert refusal.value.status_code == 422
    assert refusal.value.detail == detail


def _covers_20_years_or_more(first: date, last: date) -> bool:
    """Say whether the last day is 20 calendar years or more after the first

    A 29 February first day has its anniversary on 28 February in a year without a 29th
    """
    is_leap_day = (first.month, first.day) == (2, 29)
    anniversary_day = 28 if is_leap_day and not calendar.isleap(first.year + 20) else first.day
    return (last.year, last.month, last.day) >= (first.year + 20, first.month, anniversary_day)


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    report_range=st.one_of(
        date_ranges(EARLIEST_ALLOWED, LATEST_ALLOWED),
        date_ranges_near_span(20, EARLIEST_ALLOWED, LATEST_ALLOWED),
    )
)
def test_report_range_inside_the_window_is_refused_exactly_when_it_covers_20_years_or_more(report_range):
    """A range inside the window is refused when its last day is 20 years or more after its first

    Every other range inside the window is taken. The frontend's span check runs the same property
    over the same rule, so the two refuse the same ranges
    """
    first, last = report_range

    if _covers_20_years_or_more(first, last):
        with pytest.raises(HTTPException) as refusal:
            require_report_range(first, last)
        assert refusal.value.status_code == 422
        assert refusal.value.detail == "Range can cover at most 20 years"
    else:
        require_report_range(first, last)
