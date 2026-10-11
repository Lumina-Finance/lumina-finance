from datetime import UTC, date, datetime

from app.services.accounts.cash_flow import _get_recent_month_start_dates


def test_get_recent_month_start_dates_crosses_year_boundary():
    """Recent month starts cross from January into the previous year"""
    now = datetime(2026, 1, 15, tzinfo=UTC)

    month_starts = _get_recent_month_start_dates(now, 6)

    assert month_starts == [
        date(2025, 8, 1),
        date(2025, 9, 1),
        date(2025, 10, 1),
        date(2025, 11, 1),
        date(2025, 12, 1),
        date(2026, 1, 1),
    ]
