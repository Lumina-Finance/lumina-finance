"""Trend row helpers for the income/expense breakdown card"""

import uuid
from dataclasses import dataclass

from app.models.base import CategoryKind
from app.services.insights.income_expense_breakdown.period_stats import CategoryPeriodStatsById

CATEGORY_TREND_LIMIT = 3


@dataclass(frozen=True)
class CategoryStats:
    """Store display stats for one category in one card mode

    Attributes:
        name: Category display name
        amount: Positive display amount for the selected card mode
        transaction_count: Number of transactions behind the amount
    """

    name: str
    amount: int
    transaction_count: int


@dataclass(frozen=True)
class CategoryTrend:
    """Store category trend values before response row formatting

    Attributes:
        category_id: Category ID used in the response row
        name: Category display name
        current_amount: Positive display amount for the selected period
        previous_amount: Positive display amount for the comparison period
        change_pct: Percentage change from the comparison period
        transaction_count: Number of selected-period transactions
        change_amount: Amount movement between periods
    """

    category_id: uuid.UUID
    name: str
    current_amount: int
    previous_amount: int
    change_pct: int | None
    transaction_count: int
    change_amount: int


CategoryStatsById = dict[uuid.UUID, CategoryStats]
CategoryTrendRow = tuple[str, str, int, int, int | None, int]


def get_income_expense_breakdown_category_stats(
    period_stats: CategoryPeriodStatsById,
    kind: CategoryKind,
) -> CategoryStatsById:
    """Return display amount and transaction count by category for one card mode

    Args:
        period_stats: Signed category stats for one period
        kind: Category kind being prepared for trend comparison

    Returns:
        Display stats keyed by category ID
    """
    stats_by_id: CategoryStatsById = {}
    for category_id, stats in period_stats.items():
        if stats.category_kind != kind:
            continue
        amount = max(stats.signed_amount, 0) if kind == CategoryKind.INCOME else max(-stats.signed_amount, 0)
        stats_by_id[category_id] = CategoryStats(
            name=stats.name,
            amount=amount,
            transaction_count=stats.transaction_count,
        )
    return stats_by_id


def get_income_expense_breakdown_trend_rows(
    current_stats_by_id: CategoryStatsById,
    previous_stats_by_id: CategoryStatsById,
) -> tuple[list[CategoryTrendRow], list[CategoryTrendRow]]:
    """Return top increase and decrease rows by amount movement

    Args:
        current_stats_by_id: Selected-period category stats keyed by category ID
        previous_stats_by_id: Comparison-period category stats keyed by category ID

    Returns:
        Increase rows and decrease rows for the response
    """
    increases: list[CategoryTrend] = []
    decreases: list[CategoryTrend] = []

    # Compare every category seen in either period so new and vanished categories are included
    for category_id in set(current_stats_by_id) | set(previous_stats_by_id):
        current_stats = current_stats_by_id.get(category_id, CategoryStats("", 0, 0))
        previous_stats = previous_stats_by_id.get(category_id, CategoryStats("", 0, 0))
        change_amount = current_stats.amount - previous_stats.amount
        if change_amount == 0:
            continue

        trend = CategoryTrend(
            category_id=category_id,
            name=current_stats.name or previous_stats.name,
            current_amount=current_stats.amount,
            previous_amount=previous_stats.amount,
            change_pct=_get_change_pct(current_stats.amount, previous_stats.amount),
            transaction_count=current_stats.transaction_count,
            change_amount=change_amount,
        )
        if change_amount > 0:
            increases.append(trend)
        else:
            decreases.append(trend)

    increases.sort(key=lambda trend: (-trend.change_amount, trend.name))
    decreases.sort(key=lambda trend: (trend.change_amount, trend.name))

    return _get_trend_response_rows(increases), _get_trend_response_rows(decreases)


def _get_change_pct(current_amount: int, previous_amount: int) -> int | None:
    """Return percentage change from a previous amount

    Args:
        current_amount: Current-period display amount
        previous_amount: Comparison-period display amount

    Returns:
        Rounded percentage change, or None when there is no positive previous amount
    """
    if previous_amount <= 0:
        return None
    return round(((current_amount - previous_amount) / previous_amount) * 100)


def _get_trend_response_rows(trends: list[CategoryTrend]) -> list[CategoryTrendRow]:
    """Return API response rows from sorted category trends

    Args:
        trends: Sorted category trend values

    Returns:
        Response rows capped at the category trend limit
    """
    return [
        (
            str(trend.category_id),
            trend.name,
            trend.current_amount,
            trend.previous_amount,
            trend.change_pct,
            trend.transaction_count,
        )
        for trend in trends[:CATEGORY_TREND_LIMIT]
    ]
