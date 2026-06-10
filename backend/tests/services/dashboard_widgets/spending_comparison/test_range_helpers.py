from datetime import date

from app.services.dashboard_widgets.spending_comparison.range_helpers import get_spending_comparison_slot_ranges


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
