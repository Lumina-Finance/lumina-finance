"""Unit tests for the budget period alignment and computation service.

Pure functions — no DB, no fixtures, just stdlib date math.
"""
from datetime import date

import pytest

from app.models.base import RecurrenceFreq
from app.services.budgets.periods import compute_period_end, validate_period_start

# --- validate_period_start: weekly ---


class TestValidateWeekly:
    """Weekly alignment: period_start.weekday() must match the base's weekday."""

    @pytest.mark.parametrize("weekday,start", [
        (0, date(2026, 3, 2)),   # Monday
        (1, date(2026, 3, 3)),   # Tuesday
        (2, date(2026, 3, 4)),   # Wednesday
        (3, date(2026, 3, 5)),   # Thursday
        (4, date(2026, 3, 6)),   # Friday
        (5, date(2026, 3, 7)),   # Saturday
        (6, date(2026, 3, 8)),   # Sunday
    ])
    def test_valid_weekday(self, weekday, start):
        """Each weekday 0-6 is accepted when period_start lands on that day."""
        assert validate_period_start(start, RecurrenceFreq.WEEKLY, weekday=weekday) is None

    def test_wrong_weekday_returns_error(self):
        """Monday start rejected when base expects Tuesday."""
        result = validate_period_start(date(2026, 3, 2), RecurrenceFreq.WEEKLY, weekday=1)
        assert result is not None
        assert "Tuesday" in result

    def test_error_names_expected_day(self):
        """Error message includes the name of the expected weekday."""
        result = validate_period_start(date(2026, 3, 2), RecurrenceFreq.WEEKLY, weekday=6)
        assert "Sunday" in result


# --- validate_period_start: monthly ---


class TestValidateMonthly:
    """Monthly alignment: period_start.day must match dom (or last day of month if dom > month length)."""

    def test_dom_1_first_of_month(self):
        """Day 1 anchor accepts the first of any month."""
        assert validate_period_start(date(2026, 3, 1), RecurrenceFreq.MONTHLY, dom=1) is None

    def test_dom_15_mid_month(self):
        """Day 15 anchor accepts the 15th."""
        assert validate_period_start(date(2026, 3, 15), RecurrenceFreq.MONTHLY, dom=15) is None

    def test_dom_28_february_non_leap(self):
        """Day 28 anchor on a non-leap February is valid."""
        assert validate_period_start(date(2025, 2, 28), RecurrenceFreq.MONTHLY, dom=28) is None

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


# --- validate_period_start: yearly ---


class TestValidateYearly:
    """Yearly alignment: period_start must land on (month, dom) with last-day fallback."""

    def test_jan_1_calendar_year(self):
        """Calendar-year budget: Jan 1 is valid."""
        assert validate_period_start(date(2026, 1, 1), RecurrenceFreq.YEARLY, dom=1, month=1) is None

    def test_jul_1_fiscal_year(self):
        """Fiscal-year budget: Jul 1 is valid."""
        assert validate_period_start(date(2026, 7, 1), RecurrenceFreq.YEARLY, dom=1, month=7) is None

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


# --- compute_period_end: weekly ---


class TestComputeWeekly:
    """Weekly period_end: period_start + 7 * instance_length - 1 day."""

    def test_one_week(self):
        """Single-week instance: Mon Mar 2 → Sun Mar 8."""
        result = compute_period_end(date(2026, 3, 2), RecurrenceFreq.WEEKLY, 1)
        assert result == date(2026, 3, 8)

    def test_two_weeks(self):
        """Two-week instance: Mon Mar 2 → Sun Mar 15."""
        result = compute_period_end(date(2026, 3, 2), RecurrenceFreq.WEEKLY, 2)
        assert result == date(2026, 3, 15)

    def test_four_weeks(self):
        """Four-week instance: Mon Mar 2 → Sun Mar 29."""
        result = compute_period_end(date(2026, 3, 2), RecurrenceFreq.WEEKLY, 4)
        assert result == date(2026, 3, 29)

    def test_crosses_month_boundary(self):
        """Week that spans a month boundary: Mon Mar 30 → Sun Apr 5."""
        result = compute_period_end(date(2026, 3, 30), RecurrenceFreq.WEEKLY, 1)
        assert result == date(2026, 4, 5)


# --- compute_period_end: monthly ---


class TestComputeMonthly:
    """Monthly period_end: next_anchor - 1 day, with last-day fallback on anchor."""

    def test_dom_1_single_month(self):
        """Dom=1, 1 month: Mar 1 → Mar 31."""
        result = compute_period_end(date(2026, 3, 1), RecurrenceFreq.MONTHLY, 1, dom=1)
        assert result == date(2026, 3, 31)

    def test_dom_1_quarterly(self):
        """Dom=1, 3 months (quarterly): Jan 1 → Mar 31."""
        result = compute_period_end(date(2026, 1, 1), RecurrenceFreq.MONTHLY, 3, dom=1)
        assert result == date(2026, 3, 31)

    def test_dom_15_single_month(self):
        """Dom=15: Mar 15 → Apr 14."""
        result = compute_period_end(date(2026, 3, 15), RecurrenceFreq.MONTHLY, 1, dom=15)
        assert result == date(2026, 4, 14)

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

    def test_dom_1_two_months(self):
        """Dom=1, 2 months: Mar 1 → Apr 30."""
        result = compute_period_end(date(2026, 3, 1), RecurrenceFreq.MONTHLY, 2, dom=1)
        assert result == date(2026, 4, 30)


# --- compute_period_end: yearly ---


class TestComputeYearly:
    """Yearly period_end: next yearly anchor - 1 day."""

    def test_calendar_year(self):
        """Calendar year: Jan 1 → Dec 31."""
        result = compute_period_end(date(2026, 1, 1), RecurrenceFreq.YEARLY, 1, dom=1, month=1)
        assert result == date(2026, 12, 31)

    def test_fiscal_year_jul(self):
        """Fiscal year Jul 1 → Jun 30 of next year."""
        result = compute_period_end(date(2026, 7, 1), RecurrenceFreq.YEARLY, 1, dom=1, month=7)
        assert result == date(2027, 6, 30)

    def test_two_year_instance(self):
        """Two-year instance: Jan 1, 2026 → Dec 31, 2027."""
        result = compute_period_end(date(2026, 1, 1), RecurrenceFreq.YEARLY, 2, dom=1, month=1)
        assert result == date(2027, 12, 31)

    def test_feb_29_leap_to_non_leap(self):
        """Feb 29 in 2024 (leap) → Feb 27, 2025 (next anchor = Feb 28)."""
        result = compute_period_end(date(2024, 2, 29), RecurrenceFreq.YEARLY, 1, dom=29, month=2)
        assert result == date(2025, 2, 27)

    def test_feb_28_non_leap_to_leap(self):
        """Feb 28 in 2023 (non-leap, dom=29 fallback) → Feb 28, 2024 (next anchor = Feb 29)."""
        result = compute_period_end(date(2023, 2, 28), RecurrenceFreq.YEARLY, 1, dom=29, month=2)
        assert result == date(2024, 2, 28)
