"""Income/expense category breakdown service for the insights page"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsComparisonPeriod, InsightsIncomeExpenseBreakdownResponse
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter
from app.services.insights.common import comparison_period_bounds

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


@dataclass(frozen=True)
class CategoryPeriodStats:
    """Store signed category stats for a single period

    Attributes:
        name: Category display name
        category_kind: Original category kind
        signed_amount: Converted signed total for the period
        transaction_count: Number of transactions behind the signed amount
    """

    name: str
    category_kind: CategoryKind
    signed_amount: int
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
BreakdownCategoryStatsById = dict[uuid.UUID, BreakdownCategoryStats]
CategoryPeriodStatsById = dict[uuid.UUID, CategoryPeriodStats]
CategoryTrendRow = tuple[str, str, int, int, int | None, int]
BreakdownEntryRow = tuple[str, str, str, int]


async def _query_category_period_stats(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[CategoryPeriodStatsById, FxStatus]:
    """Return converted signed category totals and transaction counts for a period

    Args:
        db: Active database session
        accounts: Accounts included in the insight summary
        base_currency: User base currency used for converted values
        from_date: Inclusive period start date
        to_date: Inclusive period end date

    Returns:
        Converted category period stats and FX conversion status
    """
    if not accounts:
        return {}, FxStatus()

    account_ids = [account.id for account in accounts]

    # Load category totals grouped by account currency and date so each amount can use the correct FX rate
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            Category.kind,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("transaction_count"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name, Category.kind, Transaction.account_id, Transaction.dt, Account.currency),
    )
    rows = result.all()
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_breakdown_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    raw_stats: CategoryPeriodStatsById = {}

    # Convert each grouped total, then fold it into one signed total per category
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        current_stats = raw_stats.get(row.id, CategoryPeriodStats(row.name, row.kind, 0, 0))
        raw_stats[row.id] = CategoryPeriodStats(
            name=current_stats.name,
            category_kind=current_stats.category_kind,
            signed_amount=current_stats.signed_amount + converted_total,
            transaction_count=current_stats.transaction_count + int(row.transaction_count or 0),
        )

    return raw_stats, converter.get_status()


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents keyed by currency code

    Args:
        db: Active database session
        currencies: Currency codes needed for conversion

    Returns:
        Minor-unit exponent keyed by currency code
    """
    # Load currency precision so FX conversion can convert minor units correctly
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_breakdown_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    """Prefetch FX rates required by category breakdown rows

    Args:
        converter: FX converter used by the breakdown calculation
        rows: Grouped transaction rows that may require FX conversion
        base_currency: User base currency used for converted values

    Returns:
        None
    """
    ranges: dict[str, tuple[date, date]] = {}

    # Build one date range per foreign currency to avoid prefetching each row individually
    for row in rows:
        currency = row.account_currency
        if currency == base_currency:
            continue
        start, end = ranges.get(currency, (row.date, row.date))
        ranges[currency] = (min(start, row.date), max(end, row.date))

    for currency, (start_date, end_date) in sorted(ranges.items()):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


def _breakdown_stats_from_period(
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


def _category_stats_from_period(
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


def _combine_fx_statuses(current_status: FxStatus, previous_status: FxStatus) -> FxStatus:
    """Return one FX status for current and comparison period calculations

    Args:
        current_status: FX status from the selected period
        previous_status: FX status from the comparison period

    Returns:
        Combined FX status with duplicate missing pairs removed
    """
    if current_status.state == "none":
        return previous_status
    if previous_status.state == "none":
        return current_status

    missing_pairs = []
    seen_pairs = set()
    for status in (current_status, previous_status):
        for pair in status.missing_pairs:
            key = (pair.base, pair.quote)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            missing_pairs.append(pair)

    if not missing_pairs:
        return FxStatus(state="complete")

    state = "unavailable" if current_status.state == previous_status.state == "unavailable" else "incomplete"
    return FxStatus(state=state, missing_pairs=missing_pairs)


def _breakdown_sort_key(entry: tuple[uuid.UUID, BreakdownCategoryStats]) -> tuple[int, str]:
    """Return sort key for breakdown rows

    Args:
        entry: Category ID and breakdown stats being ranked

    Returns:
        Sort key using descending amount and ascending category name
    """
    _category_id, stats = entry
    return -stats.amount, stats.name


def _breakdown_entries(
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
    positive_entries.sort(key=_breakdown_sort_key)

    return [
        (str(category_id), stats.name, stats.category_kind.value, stats.amount)
        for category_id, stats in positive_entries
    ]


def _breakdown_total(stats_by_id: BreakdownCategoryStatsById) -> int:
    """Return total amount across breakdown stats

    Args:
        stats_by_id: Breakdown stats keyed by category ID

    Returns:
        Sum of all category breakdown amounts
    """
    return sum(stats.amount for stats in stats_by_id.values())


def _change_pct(current_amount: int, previous_amount: int) -> int | None:
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


def _category_trends(
    current_stats_by_id: CategoryStatsById,
    previous_stats_by_id: CategoryStatsById,
) -> tuple[list[CategoryTrendRow], list[CategoryTrendRow]]:
    """Return top increases and decreases by dollar movement

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


async def get_income_expense_breakdown(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsIncomeExpenseBreakdownResponse:
    """Return category breakdown and trend rows for the income/expense card

    Args:
        db: Active database session
        user: User requesting the insight summary
        from_date: Inclusive selected period start date
        to_date: Inclusive selected period end date
        comparison_period: Comparison period used for trend rows

    Returns:
        Income and expense breakdown response payload
    """
    previous_from_date, previous_to_date = comparison_period_bounds(from_date, to_date, comparison_period)
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        return InsightsIncomeExpenseBreakdownResponse(
            expense=[],
            income=[],
            expense_total=0,
            income_total=0,
            expense_increases=[],
            expense_decreases=[],
            income_increases=[],
            income_decreases=[],
        )

    current_period_stats, current_fx_status = await _query_category_period_stats(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    previous_period_stats, previous_fx_status = await _query_category_period_stats(
        db,
        accounts,
        user.base_currency,
        previous_from_date,
        previous_to_date,
    )
    current_expense_breakdown, current_income_breakdown = _breakdown_stats_from_period(current_period_stats)
    current_expense_stats = _category_stats_from_period(current_period_stats, CategoryKind.EXPENSE)
    previous_expense_stats = _category_stats_from_period(previous_period_stats, CategoryKind.EXPENSE)
    current_income_stats = _category_stats_from_period(current_period_stats, CategoryKind.INCOME)
    previous_income_stats = _category_stats_from_period(previous_period_stats, CategoryKind.INCOME)

    expense_increases, expense_decreases = _category_trends(current_expense_stats, previous_expense_stats)
    income_increases, income_decreases = _category_trends(current_income_stats, previous_income_stats)
    expense_refunds = sum(
        stats.amount
        for stats in current_income_breakdown.values()
        if stats.category_kind == CategoryKind.EXPENSE
    )
    income_losses = sum(
        stats.amount
        for stats in current_expense_breakdown.values()
        if stats.category_kind == CategoryKind.INCOME
    )

    return InsightsIncomeExpenseBreakdownResponse(
        expense=_breakdown_entries(current_expense_breakdown),
        income=_breakdown_entries(current_income_breakdown),
        expense_total=max(_breakdown_total(current_expense_breakdown) - expense_refunds, 0),
        income_total=max(_breakdown_total(current_income_breakdown) - income_losses, 0),
        expense_increases=expense_increases,
        expense_decreases=expense_decreases,
        income_increases=income_increases,
        income_decreases=income_decreases,
        fx_status=_combine_fx_statuses(current_fx_status, previous_fx_status),
    )
