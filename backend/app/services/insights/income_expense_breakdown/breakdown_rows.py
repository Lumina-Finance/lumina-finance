"""Breakdown row helpers for the income/expense breakdown card"""

import uuid
from dataclasses import dataclass

from app.models.base import CategoryKind
from app.services.insights.income_expense_breakdown.period_stats import CategoryPeriodStatsById


@dataclass(frozen=True)
class BreakdownCategoryStats:
    """Store category stats used by the pie breakdown rows

    Attributes:
        name: Category display name
        category_kind: Original category kind before sign-directed display
        amount: Positive display amount for the breakdown row
    """

    name: str
    category_kind: CategoryKind
    amount: int


BreakdownCategoryStatsById = dict[uuid.UUID, BreakdownCategoryStats]
BreakdownEntryRow = tuple[str, str, str, int]


def get_income_expense_breakdown_stats_by_side(
    period_stats: CategoryPeriodStatsById,
) -> tuple[BreakdownCategoryStatsById, BreakdownCategoryStatsById]:
    """Return sign-directed category totals for the pie breakdowns

    Args:
        period_stats: Signed category stats for the selected period

    Returns:
        Expense-side and income-side breakdown stats keyed by category ID
    """
    expense_stats: BreakdownCategoryStatsById = {}
    income_stats: BreakdownCategoryStatsById = {}

    # Route categories by net sign so refunds and losses appear on the side they affect
    for category_id, stats in period_stats.items():
        if stats.signed_amount < 0:
            expense_stats[category_id] = BreakdownCategoryStats(
                name=stats.name,
                category_kind=stats.category_kind,
                amount=-stats.signed_amount,
            )
        elif stats.signed_amount > 0:
            income_stats[category_id] = BreakdownCategoryStats(
                name=stats.name,
                category_kind=stats.category_kind,
                amount=stats.signed_amount,
            )
    return expense_stats, income_stats


def get_income_expense_breakdown_rows(
    stats_by_id: BreakdownCategoryStatsById,
) -> list[BreakdownEntryRow]:
    """Return every positive category row for the pie breakdown

    Args:
        stats_by_id: Breakdown stats keyed by category ID

    Returns:
        Sorted response rows for the pie breakdown
    """
    positive_entries = [
        (category_id, stats)
        for category_id, stats in stats_by_id.items()
        if stats.amount > 0
    ]
    positive_entries.sort(key=_get_breakdown_sort_key)

    return [
        (str(category_id), stats.name, stats.category_kind.value, stats.amount)
        for category_id, stats in positive_entries
    ]


def get_income_expense_breakdown_total(stats_by_id: BreakdownCategoryStatsById) -> int:
    """Return total amount across breakdown stats

    Args:
        stats_by_id: Breakdown stats keyed by category ID

    Returns:
        Sum of all category breakdown amounts
    """
    return sum(stats.amount for stats in stats_by_id.values())


def _get_breakdown_sort_key(entry: tuple[uuid.UUID, BreakdownCategoryStats]) -> tuple[int, str]:
    """Return sort key for breakdown rows

    Args:
        entry: Category ID and breakdown stats being ranked

    Returns:
        Sort key using descending amount and ascending category name
    """
    _category_id, stats = entry
    return -stats.amount, stats.name
