"""Date window tests: where the window ends and which report ranges are refused"""

from datetime import UTC, date, datetime

import pytest
from fastapi import HTTPException

from app.utils import date_window
from app.utils.date_window import get_latest_allowed_date, get_window_error, require_report_range

# 23:30 UTC on 9 June is already 10 June in the furthest-ahead timezone, so a window counted from
# the UTC date would end a day early for a user there
LATE_EVENING_UTC = datetime(2026, 6, 9, 23, 30, tzinfo=UTC)


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
        (date(1900, 1, 1), date(1919, 12, 31)),
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
