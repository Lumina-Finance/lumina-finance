"""Spending comparison slot total helpers"""

from datetime import date, timedelta

from app.schemas.dashboard import RangeKind
from app.services.dashboard_widgets.spending_comparison.range_helpers import (
    DateSlotRange,
    get_spending_comparison_slot_ranges,
)

# How many of the latest whole periods the average covers, matching the 12 weeks, 12 months, 4 quarters and
# 3 years of the WTD, MTD, QTD and YTD views. Older ones are left out so the query and the FX window stay small
AVERAGE_PERIOD_LIMIT_BY_RANGE: dict[RangeKind, int] = {"WTD": 12, "MTD": 12, "QTD": 4, "YTD": 3}


def sum_days(daily_values: dict[date, int], start: date, end: date) -> int:
    """Sum daily totals across an inclusive date range

    Args:
        daily_values: Daily totals keyed by date
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Sum of daily values inside the requested range
    """
    total = 0
    current_day = start
    while current_day <= end:
        total += daily_values.get(current_day, 0)
        current_day += timedelta(days=1)
    return total


def cumulative_totals(values: list[int]) -> list[int]:
    """Return the running cumulative sum of values

    Args:
        values: Ordered values to accumulate

    Returns:
        Running cumulative totals with the same length as ``values``
    """
    running = 0
    cumulative_values: list[int] = []
    for value in values:
        running += value
        cumulative_values.append(running)
    return cumulative_values


def get_completed_period_slot_ranges(
    range_: RangeKind,
    current_period_start: date,
    first_transaction_date: date,
) -> list[list[DateSlotRange]]:
    """Return the slot ranges of each completed period that counts toward the average

    A period counts only when it starts on or after the first transaction, so the partial period the
    history begins inside is left out, and only the latest few count, as many as the range's limit.
    Periods are returned newest first

    Args:
        range_: Calendar period requested by the dashboard
        current_period_start: First day of the period being viewed, which never counts
        first_transaction_date: Date of the user's first expense or income transaction

    Returns:
        Full slot ranges for each counted period
    """
    periods: list[list[DateSlotRange]] = []
    period_start = current_period_start

    # Anchoring a range on a period's last day makes the current-period slots cover the whole period
    while len(periods) < AVERAGE_PERIOD_LIMIT_BY_RANGE[range_]:
        period_end = period_start - timedelta(days=1)
        slot_ranges = get_spending_comparison_slot_ranges(range_, period_end)[1]
        period_start = slot_ranges[0][0]
        if period_start < first_transaction_date:
            break
        periods.append(slot_ranges)
    return periods


def get_average_slot_sums(
    periods: list[list[DateSlotRange]],
    daily_expenses: dict[date, int],
    slot_count: int,
) -> tuple[list[int], list[int]]:
    """Return per-slot sums of cumulative spending and how many periods contribute to each slot

    A period with no spending across its whole span is left out of the sums and the counts, as runway
    leaves out months with no expense outflow. A period that spends only later in its span still counts,
    with zero for its early slots. A slot only counts the periods that have it, so day 31 sums only
    months with a day 31. The slots are cut to the viewed period's length, since it cannot show a slot it lacks

    Args:
        periods: Full slot ranges of each counted period
        daily_expenses: Converted daily expenses keyed by date
        slot_count: Number of slots the viewed period shows

    Returns:
        Sums and period counts per slot, empty when no period has spending
    """
    sums = [0] * slot_count
    counts = [0] * slot_count
    for slot_ranges in periods:
        slot_totals = [sum_days(daily_expenses, start, end) for start, end in slot_ranges]
        if sum(slot_totals) <= 0:
            continue
        for index, running in enumerate(cumulative_totals(slot_totals)[:slot_count]):
            sums[index] += running
            counts[index] += 1

    used = sum(1 for count in counts if count > 0)
    return sums[:used], counts[:used]
