"""Budget period tests: which starts each cadence accepts and where each period ends

Pure functions, no database. The properties hold the next start the backend computes, the day after
a period ends, to the start check a submitted start must pass, so a series never skips or repeats a
period nor steps onto a start the backend itself would refuse. The examples pin the anchor days a
short month or leap year clamps, since the properties' own calendar arithmetic could get those wrong too
"""

import calendar
from datetime import date, timedelta

from hypothesis import given
from hypothesis import strategies as st

from app.models.base import RecurrenceFreq
from app.services.budgets.periods import compute_period_end, validate_period_start
from tests.routes.support.generators import EARLIEST_DAY, LATEST_DAY, calendar_days

_PERIOD_YEARS = st.integers(min_value=EARLIEST_DAY.year, max_value=LATEST_DAY.year)
# Any month, with February, the month a leap year changes, drawn half the time
_MONTHS = st.one_of(st.integers(min_value=1, max_value=12), st.just(2))
# Any anchor day, with the days a short month clamps drawn half the time
_DAYS_OF_MONTH = st.one_of(st.integers(min_value=1, max_value=31), st.integers(min_value=28, max_value=31))
_WEEKDAYS = st.integers(min_value=0, max_value=6)
_WEEKLY_LENGTHS = st.integers(min_value=1, max_value=52)
_MONTHLY_LENGTHS = st.integers(min_value=1, max_value=36)
_YEARLY_LENGTHS = st.integers(min_value=1, max_value=10)


def _get_anchor_date(year, month, dom):
    """Return the valid anchor date for a configured day of month"""
    anchor_day = min(dom, calendar.monthrange(year, month)[1])
    return date(year, month, anchor_day)


def _add_months(year, month, months):
    """Return the year and month after adding calendar months"""
    total_months = (year * 12 + month - 1) + months
    next_year = total_months // 12
    next_month = total_months % 12 + 1
    return next_year, next_month


class TestValidateWeekly:
    """Weekly alignment: period_start.weekday() must match the base's weekday."""

    def test_wrong_weekday_returns_error(self):
        """Monday start rejected when base expects Tuesday."""
        result = validate_period_start(date(2026, 3, 2), RecurrenceFreq.WEEKLY, weekday=1)
        assert result is not None
        assert "Tuesday" in result


class TestValidateMonthly:
    """Monthly alignment: period_start.day must match dom (or last day of month if dom > month length)."""

    def test_dom_29_february_leap(self):
        """Day 29 anchor on a leap February (Feb 29 exists) is valid."""
        assert validate_period_start(date(2024, 2, 29), RecurrenceFreq.MONTHLY, dom=29) is None

    def test_dom_29_february_non_leap_falls_back_to_28(self):
        """Day 29 anchor on non-leap Feb accepts Feb 28 (last-day fallback)."""
        assert validate_period_start(date(2025, 2, 28), RecurrenceFreq.MONTHLY, dom=29) is None

    def test_dom_29_february_non_leap_rejects_27(self):
        """Day 29 anchor on non-leap Feb rejects Feb 27 (not the last day)."""
        result = validate_period_start(date(2025, 2, 27), RecurrenceFreq.MONTHLY, dom=29)
        assert result is not None

    def test_dom_31_on_30_day_month_falls_back_to_30(self):
        """Day 31 anchor on a 30-day month accepts the 30th."""
        assert validate_period_start(date(2026, 4, 30), RecurrenceFreq.MONTHLY, dom=31) is None

    def test_dom_31_on_31_day_month(self):
        """Day 31 anchor on a 31-day month accepts the 31st."""
        assert validate_period_start(date(2026, 3, 31), RecurrenceFreq.MONTHLY, dom=31) is None

    def test_dom_31_on_30_day_month_rejects_29(self):
        """Day 31 anchor on a 30-day month rejects the 29th."""
        result = validate_period_start(date(2026, 4, 29), RecurrenceFreq.MONTHLY, dom=31)
        assert result is not None

    def test_wrong_day_returns_error(self):
        """A day that doesn't match dom returns an error string."""
        result = validate_period_start(date(2026, 3, 10), RecurrenceFreq.MONTHLY, dom=15)
        assert result is not None
        assert "day 15" in result


class TestValidateYearly:
    """Yearly alignment: period_start must land on (month, dom) with last-day fallback."""

    def test_feb_29_leap_year(self):
        """Feb 29 anchor in a leap year is valid."""
        assert validate_period_start(date(2024, 2, 29), RecurrenceFreq.YEARLY, dom=29, month=2) is None

    def test_feb_29_non_leap_falls_back_to_28(self):
        """Feb 29 anchor in a non-leap year accepts Feb 28 (last-day fallback)."""
        assert validate_period_start(date(2025, 2, 28), RecurrenceFreq.YEARLY, dom=29, month=2) is None

    def test_wrong_month_returns_error(self):
        """Starting in the wrong month is rejected."""
        result = validate_period_start(date(2026, 3, 1), RecurrenceFreq.YEARLY, dom=1, month=7)
        assert result is not None

    def test_wrong_day_returns_error(self):
        """Starting on the right month but wrong day is rejected."""
        result = validate_period_start(date(2026, 7, 15), RecurrenceFreq.YEARLY, dom=1, month=7)
        assert result is not None


class TestComputeWeekly:
    """Weekly period_end: period_start + 7 * instance_length - 1 day."""

    @given(
        day=calendar_days(),
        weekday=_WEEKDAYS,
        instance_length=_WEEKLY_LENGTHS,
    )
    def test_weekly_period_ends_the_day_before_a_next_start_the_check_accepts(self, day, weekday, instance_length):
        """A weekly period on any anchor weekday ends the day before a next start the start check accepts"""
        period_start = day + timedelta(days=(weekday - day.weekday()) % 7)

        period_end = compute_period_end(period_start, RecurrenceFreq.WEEKLY, instance_length)
        next_period_start = period_end + timedelta(days=1)

        assert validate_period_start(period_start, RecurrenceFreq.WEEKLY, weekday=weekday) is None
        assert next_period_start == period_start + timedelta(weeks=instance_length)
        assert validate_period_start(next_period_start, RecurrenceFreq.WEEKLY, weekday=weekday) is None


class TestComputeMonthly:
    """Monthly period_end: next_anchor - 1 day, with last-day fallback on anchor."""

    def test_dom_31_january(self):
        """Dom=31: Jan 31 → Feb 27 (non-leap, next anchor = Feb 28)."""
        result = compute_period_end(date(2026, 1, 31), RecurrenceFreq.MONTHLY, 1, dom=31)
        assert result == date(2026, 2, 27)

    def test_dom_31_january_leap_year(self):
        """Dom=31: Jan 31 in a leap year → Feb 28 (next anchor = Feb 29)."""
        result = compute_period_end(date(2024, 1, 31), RecurrenceFreq.MONTHLY, 1, dom=31)
        assert result == date(2024, 2, 28)

    def test_dom_31_april(self):
        """Dom=31: Apr 30 (fallback anchor) → May 30 (next anchor = May 31)."""
        result = compute_period_end(date(2026, 4, 30), RecurrenceFreq.MONTHLY, 1, dom=31)
        assert result == date(2026, 5, 30)

    def test_dom_29_february_non_leap(self):
        """Dom=29: Feb 28 (fallback) → Mar 28 (next anchor = Mar 29)."""
        result = compute_period_end(date(2025, 2, 28), RecurrenceFreq.MONTHLY, 1, dom=29)
        assert result == date(2025, 3, 28)

    def test_dom_1_crosses_year_boundary(self):
        """Dom=1: Dec 1 → Dec 31 (next anchor = Jan 1 of next year)."""
        result = compute_period_end(date(2026, 12, 1), RecurrenceFreq.MONTHLY, 1, dom=1)
        assert result == date(2026, 12, 31)

    @given(
        year=_PERIOD_YEARS,
        month=_MONTHS,
        dom=_DAYS_OF_MONTH,
        instance_length=_MONTHLY_LENGTHS,
    )
    def test_monthly_period_ends_the_day_before_a_next_start_the_check_accepts(self, year, month, dom, instance_length):
        """A monthly period on any anchor day ends the day before a next anchor the start check accepts"""
        period_start = _get_anchor_date(year, month, dom)
        next_year, next_month = _add_months(year, month, instance_length)

        period_end = compute_period_end(period_start, RecurrenceFreq.MONTHLY, instance_length, dom=dom)
        next_period_start = period_end + timedelta(days=1)

        assert validate_period_start(period_start, RecurrenceFreq.MONTHLY, dom=dom) is None
        assert next_period_start == _get_anchor_date(next_year, next_month, dom)
        assert validate_period_start(next_period_start, RecurrenceFreq.MONTHLY, dom=dom) is None


class TestComputeYearly:
    """Yearly period_end: next yearly anchor - 1 day."""

    def test_feb_29_leap_to_non_leap(self):
        """Feb 29 in 2024 (leap) → Feb 27, 2025 (next anchor = Feb 28)."""
        result = compute_period_end(date(2024, 2, 29), RecurrenceFreq.YEARLY, 1, dom=29, month=2)
        assert result == date(2025, 2, 27)

    def test_feb_28_non_leap_to_leap(self):
        """Feb 28 in 2023 (non-leap, dom=29 fallback) → Feb 28, 2024 (next anchor = Feb 29)."""
        result = compute_period_end(date(2023, 2, 28), RecurrenceFreq.YEARLY, 1, dom=29, month=2)
        assert result == date(2024, 2, 28)

    @given(
        year=_PERIOD_YEARS,
        month=_MONTHS,
        dom=_DAYS_OF_MONTH,
        instance_length=_YEARLY_LENGTHS,
    )
    def test_yearly_period_ends_the_day_before_a_next_start_the_check_accepts(self, year, month, dom, instance_length):
        """A yearly period on any anchor day ends the day before a next anchor the start check accepts"""
        period_start = _get_anchor_date(year, month, dom)

        period_end = compute_period_end(period_start, RecurrenceFreq.YEARLY, instance_length, dom=dom, month=month)
        next_period_start = period_end + timedelta(days=1)

        assert validate_period_start(period_start, RecurrenceFreq.YEARLY, dom=dom, month=month) is None
        assert next_period_start == _get_anchor_date(year + instance_length, month, dom)
        assert validate_period_start(next_period_start, RecurrenceFreq.YEARLY, dom=dom, month=month) is None
