import uuid
from datetime import UTC, date, datetime

from app.services.accounts.cash_flow import _get_recent_month_start_dates, get_account_cash_flow_history


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


async def test_get_account_cash_flow_history_zero_fills_missing_months(db):
    """Account cash-flow history returns oldest-first zero rows for months without activity"""
    account_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    now = datetime(2026, 3, 15, tzinfo=UTC)

    cash_flow_history = await get_account_cash_flow_history(db, account_id, 3, now)

    assert [entry.model_dump(mode="json") for entry in cash_flow_history] == [
        {"month": "2026-01-01", "income": 0, "expenses": 0},
        {"month": "2026-02-01", "income": 0, "expenses": 0},
        {"month": "2026-03-01", "income": 0, "expenses": 0},
    ]
