"""The count behind the most periods one budget keeps, on each side of 1,200

Pure, no database. The route tests check each refusal reaches the person, so the boundary for each
cadence is pinned here. The one-week and one-month dates match the frontend's validation tests, counted
to the same today
"""

from datetime import date

import pytest
from fastapi import HTTPException

from app.models.base import RecurrenceFreq
from app.services.budgets.limits import ensure_series_within_period_limit

# 4 May 2026, a Monday, so a weekly series can start on a Monday and hold a period starting today
TODAY = date(2026, 5, 4)


def _check(period_start: date, freq: RecurrenceFreq, instance_length: int = 1, dom: int | None = None) -> None:
    """Count the series from period_start to TODAY against the limit"""
    ensure_series_within_period_limit(period_start, TODAY, freq, instance_length, dom=dom, month=None, detail="refused")


@pytest.mark.parametrize(
    ("period_start", "freq", "instance_length", "dom"),
    [
        pytest.param(date(1926, 6, 1), RecurrenceFreq.MONTHLY, 1, 1, id="1,200 months"),
        pytest.param(date(1926, 5, 31), RecurrenceFreq.MONTHLY, 1, 31, id="1,200 months on day 31"),
        pytest.param(date(2003, 5, 12), RecurrenceFreq.WEEKLY, 1, None, id="1,200 weeks"),
        pytest.param(date(1980, 5, 19), RecurrenceFreq.WEEKLY, 2, None, id="1,200 fortnights"),
        pytest.param(date(1926, 5, 1), RecurrenceFreq.MONTHLY, 2, 1, id="601 two-month periods"),
    ],
)
def test_a_series_of_at_most_1200_periods_passes(period_start, freq, instance_length, dom):
    """A series whose periods to today come to 1,200 or fewer is let through"""
    _check(period_start, freq, instance_length, dom)


@pytest.mark.parametrize(
    ("period_start", "freq", "instance_length", "dom"),
    [
        pytest.param(date(1926, 5, 1), RecurrenceFreq.MONTHLY, 1, 1, id="1,201 months"),
        pytest.param(date(1926, 3, 31), RecurrenceFreq.MONTHLY, 1, 31, id="1,202 months on day 31"),
        pytest.param(date(2003, 5, 5), RecurrenceFreq.WEEKLY, 1, None, id="1,201 weeks"),
        pytest.param(date(1980, 5, 5), RecurrenceFreq.WEEKLY, 2, None, id="1,201 fortnights"),
    ],
)
def test_a_series_past_1200_periods_is_refused_with_the_given_reason(period_start, freq, instance_length, dom):
    """One period past the limit is refused with a 422 carrying the reason the caller gave"""
    with pytest.raises(HTTPException) as refused:
        _check(period_start, freq, instance_length, dom)

    assert (refused.value.status_code, refused.value.detail) == (422, "refused")
