from datetime import date

import pytest

from app.services.dashboard_widgets.spending_comparison.slot_total_helpers import (
    AVERAGE_PERIOD_LIMIT_BY_RANGE,
    get_average_slot_sums,
    get_completed_period_slot_ranges,
)


def _period_starts(periods):
    """Return the first day of each period, newest first"""
    return [slot_ranges[0][0] for slot_ranges in periods]


def test_months_walk_back_across_the_year_boundary():
    """Months before February walk back through January into the year before"""
    periods = get_completed_period_slot_ranges("MTD", date(2026, 2, 1), date(2025, 11, 1))

    assert _period_starts(periods) == [date(2026, 1, 1), date(2025, 12, 1), date(2025, 11, 1)]


def test_a_month_starting_before_the_first_transaction_is_left_out():
    """The month the history begins inside is partial, so it does not count"""
    periods = get_completed_period_slot_ranges("MTD", date(2026, 2, 1), date(2025, 11, 2))

    assert _period_starts(periods) == [date(2026, 1, 1), date(2025, 12, 1)]


def test_leap_february_has_a_twenty_ninth_slot_and_a_common_one_does_not():
    """A leap February holds 29 daily slots and a common one 28"""
    leap = get_completed_period_slot_ranges("MTD", date(2024, 3, 1), date(2024, 2, 1))
    common = get_completed_period_slot_ranges("MTD", date(2026, 3, 1), date(2026, 2, 1))

    assert len(leap[0]) == 29
    assert len(common[0]) == 28


def test_weeks_run_monday_to_sunday_across_new_year():
    """A week spanning New Year stays whole, Monday to Sunday"""
    periods = get_completed_period_slot_ranges("WTD", date(2026, 1, 5), date(2025, 12, 22))

    assert _period_starts(periods) == [date(2025, 12, 29), date(2025, 12, 22)]
    assert periods[0][-1] == (date(2026, 1, 4), date(2026, 1, 4))


def test_quarters_have_thirteen_or_fourteen_weekly_slots():
    """A 92-day quarter has a 14th single-day week, and the first quarter's last week is cut short"""
    periods = get_completed_period_slot_ranges("QTD", date(2026, 10, 1), date(2026, 1, 1))

    assert [len(slot_ranges) for slot_ranges in periods] == [14, 13, 13]
    assert periods[2][-1] == (date(2026, 3, 26), date(2026, 3, 31))


def test_years_hold_twelve_month_slots():
    """Each completed year is twelve month slots"""
    periods = get_completed_period_slot_ranges("YTD", date(2026, 1, 1), date(2024, 1, 1))

    assert _period_starts(periods) == [date(2025, 1, 1), date(2024, 1, 1)]
    assert len(periods[0]) == 12


@pytest.mark.parametrize(
    ("range_", "current_start", "window", "oldest_start"),
    [
        ("WTD", date(2026, 7, 13), 12, date(2026, 4, 20)),
        ("MTD", date(2026, 7, 1), 12, date(2025, 7, 1)),
        ("QTD", date(2026, 7, 1), 4, date(2025, 7, 1)),
        ("YTD", date(2026, 1, 1), 3, date(2023, 1, 1)),
    ],
)
def test_history_covers_only_the_latest_periods_of_the_window(range_, current_start, window, oldest_start):
    """A first transaction decades back counts no further than 12 weeks, 12 months, 4 quarters or 3 years"""
    periods = get_completed_period_slot_ranges(range_, current_start, date(2002, 1, 1))

    assert len(periods) == window == AVERAGE_PERIOD_LIMIT_BY_RANGE[range_]
    assert _period_starts(periods)[-1] == oldest_start


def test_history_shorter_than_the_window_counts_the_periods_it_has():
    """Five whole months of history are five periods, not twelve"""
    periods = get_completed_period_slot_ranges("MTD", date(2026, 7, 1), date(2026, 2, 1))

    assert len(periods) == 5


def test_sums_cut_to_the_viewed_slots_and_count_only_periods_with_each_slot():
    """Day 29 to 31 count only the longer month, and a shorter viewed month cuts them off"""
    long_month = [(date(2026, 1, day), date(2026, 1, day)) for day in range(1, 32)]
    short_month = [(date(2026, 2, day), date(2026, 2, day)) for day in range(1, 29)]
    daily = {date(2026, 1, 31): 500, date(2026, 2, 28): 100}

    sums, counts = get_average_slot_sums([long_month, short_month], daily, 31)

    assert counts == [2] * 28 + [1] * 3
    assert sums[27] == 100
    assert sums[30] == 500

    cut_sums, cut_counts = get_average_slot_sums([long_month, short_month], daily, 30)

    assert len(cut_sums) == len(cut_counts) == 30


def test_a_period_without_spending_is_left_out_of_sums_and_counts():
    """An empty month in the middle changes neither, and one spending only late counts with zeros before it"""
    january = [(date(2026, 1, day), date(2026, 1, day)) for day in range(1, 32)]
    february = [(date(2026, 2, day), date(2026, 2, day)) for day in range(1, 29)]
    march = [(date(2026, 3, day), date(2026, 3, day)) for day in range(1, 32)]
    daily = {date(2026, 1, 3): 100, date(2026, 3, 30): 300}

    sums, counts = get_average_slot_sums([march, february, january], daily, 31)

    assert counts == [2] * 31
    assert sums[0] == 0
    assert sums[2] == 100
    assert sums[28] == 100
    assert sums[29] == 400


def test_periods_that_are_all_empty_give_empty_sums():
    """When no period in the window has spending there is no average"""
    january = [(date(2026, 1, day), date(2026, 1, day)) for day in range(1, 32)]

    assert get_average_slot_sums([january], {}, 31) == ([], [])


def test_no_periods_give_empty_sums():
    """Without a counted period there is nothing to average"""
    assert get_average_slot_sums([], {}, 31) == ([], [])
