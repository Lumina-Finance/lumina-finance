"""Income/expense category breakdown service for the insights page."""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.insights import InsightsIncomeExpenseBreakdownResponse
from app.services.insights.common import get_base_currency_accounts, previous_period_bounds

BREAKDOWN_CATEGORY_LIMIT = 7
CATEGORY_TREND_LIMIT = 3


@dataclass(frozen=True)
class CategoryStats:
    name: str
    amount: int
    transaction_count: int


@dataclass(frozen=True)
class BreakdownCategoryStats:
    name: str
    category_kind: CategoryKind
    amount: int


@dataclass(frozen=True)
class CategoryTrend:
    category_id: uuid.UUID
    name: str
    current_amount: int
    previous_amount: int
    change_pct: int | None
    transaction_count: int
    change_amount: int


CategoryStatsById = dict[uuid.UUID, CategoryStats]
BreakdownCategoryStatsById = dict[uuid.UUID, BreakdownCategoryStats]
CategoryTrendRow = tuple[str, str, int, int, int | None, int]
BreakdownEntryRow = tuple[str, str, str, int]


async def _query_breakdown_entries(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> tuple[BreakdownCategoryStatsById, BreakdownCategoryStatsById]:
    """Return sign-directed category totals for the pie breakdowns."""
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            Category.kind,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name, Category.kind),
    )

    expense_stats: BreakdownCategoryStatsById = {}
    income_stats: BreakdownCategoryStatsById = {}
    for row in result:
        total = int(row.total or 0)
        if total < 0:
            expense_stats[row.id] = BreakdownCategoryStats(
                name=row.name,
                category_kind=row.kind,
                amount=-total,
            )
        elif total > 0:
            income_stats[row.id] = BreakdownCategoryStats(
                name=row.name,
                category_kind=row.kind,
                amount=total,
            )

    return expense_stats, income_stats


async def _query_breakdown_category_stats(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    kind: CategoryKind,
    from_date: date,
    to_date: date,
) -> CategoryStatsById:
    """Return display amount and transaction count by category for one card mode."""
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("transaction_count"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind == kind,
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name),
    )

    stats_by_id: CategoryStatsById = {}
    for row in result:
        total = int(row.total or 0)
        amount = max(total, 0) if kind == CategoryKind.INCOME else max(-total, 0)
        stats_by_id[row.id] = CategoryStats(
            name=row.name,
            amount=amount,
            transaction_count=int(row.transaction_count or 0),
        )
    return stats_by_id


def _breakdown_sort_key(entry: tuple[uuid.UUID, BreakdownCategoryStats]) -> tuple[int, str]:
    _category_id, stats = entry
    return -stats.amount, stats.name


def _breakdown_entries(
    stats_by_id: BreakdownCategoryStatsById,
    kind: CategoryKind,
) -> list[BreakdownEntryRow]:
    """Return top category rows plus a compact Other row when needed."""
    positive_entries = [
        (category_id, stats)
        for category_id, stats in stats_by_id.items()
        if stats.amount > 0
    ]
    positive_entries.sort(key=_breakdown_sort_key)

    visible_entries = positive_entries[:BREAKDOWN_CATEGORY_LIMIT]
    other_amount = sum(stats.amount for _category_id, stats in positive_entries[BREAKDOWN_CATEGORY_LIMIT:])
    rows = [
        (str(category_id), stats.name, stats.category_kind.value, stats.amount)
        for category_id, stats in visible_entries
    ]
    if other_amount > 0:
        rows.append((f"{kind.value}-other", "Other", kind.value, other_amount))
    return rows


def _change_pct(current_amount: int, previous_amount: int) -> int | None:
    if previous_amount <= 0:
        return None
    return round(((current_amount - previous_amount) / previous_amount) * 100)


def _category_trends(
    current_stats_by_id: CategoryStatsById,
    previous_stats_by_id: CategoryStatsById,
) -> tuple[list[CategoryTrendRow], list[CategoryTrendRow]]:
    """Return top increases and decreases by dollar movement."""
    increases: list[CategoryTrend] = []
    decreases: list[CategoryTrend] = []
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
            change_pct=_change_pct(current_stats.amount, previous_stats.amount),
            transaction_count=current_stats.transaction_count,
            change_amount=change_amount,
        )
        if change_amount > 0:
            increases.append(trend)
        else:
            decreases.append(trend)

    increases.sort(key=lambda trend: (-trend.change_amount, trend.name))
    decreases.sort(key=lambda trend: (trend.change_amount, trend.name))

    return _response_rows(increases), _response_rows(decreases)


def _response_rows(trends: list[CategoryTrend]) -> list[CategoryTrendRow]:
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


async def get_income_expense_breakdown(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsIncomeExpenseBreakdownResponse:
    """Return category breakdown and trend rows for the income/expense card."""
    previous_from_date, previous_to_date = previous_period_bounds(from_date, to_date)
    base_currency_accounts = await get_base_currency_accounts(db, user)
    account_ids = [account.id for account in base_currency_accounts]

    if not account_ids:
        return InsightsIncomeExpenseBreakdownResponse(
            expense=[],
            income=[],
            expense_increases=[],
            expense_decreases=[],
            income_increases=[],
            income_decreases=[],
        )

    current_expense_breakdown, current_income_breakdown = await _query_breakdown_entries(
        db,
        account_ids,
        from_date,
        to_date,
    )
    current_expense_stats = await _query_breakdown_category_stats(
        db,
        account_ids,
        CategoryKind.EXPENSE,
        from_date,
        to_date,
    )
    previous_expense_stats = await _query_breakdown_category_stats(
        db,
        account_ids,
        CategoryKind.EXPENSE,
        previous_from_date,
        previous_to_date,
    )
    current_income_stats = await _query_breakdown_category_stats(
        db,
        account_ids,
        CategoryKind.INCOME,
        from_date,
        to_date,
    )
    previous_income_stats = await _query_breakdown_category_stats(
        db,
        account_ids,
        CategoryKind.INCOME,
        previous_from_date,
        previous_to_date,
    )

    expense_increases, expense_decreases = _category_trends(current_expense_stats, previous_expense_stats)
    income_increases, income_decreases = _category_trends(current_income_stats, previous_income_stats)

    return InsightsIncomeExpenseBreakdownResponse(
        expense=_breakdown_entries(current_expense_breakdown, CategoryKind.EXPENSE),
        income=_breakdown_entries(current_income_breakdown, CategoryKind.INCOME),
        expense_increases=expense_increases,
        expense_decreases=expense_decreases,
        income_increases=income_increases,
        income_decreases=income_decreases,
    )
