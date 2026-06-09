"""Spending-breakdown dashboard widget service"""
import uuid
from datetime import date, datetime, timedelta
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.schemas.dashboard import (
    CategoryBreakdownEntry,
    RangeKind,
    SpendingBreakdownResponse,
)
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter

DASHBOARD_BREAKDOWN_CATEGORY_LIMIT = 6

_CategoryTotals = dict[uuid.UUID, tuple[str, CategoryKind, int]]


class _CategoryDailyTotal(NamedTuple):
    """Daily aggregate row for one account and category

    Attributes:
        transaction_date: Date represented by the aggregate row
        account_id: Account that owns the aggregated transactions
        category_id: Category represented by the aggregate row
        category_name: Display name for the category
        category_kind: Category classification used to split income and expense
        amount: Signed total amount in the account currency
    """

    transaction_date: date
    account_id: uuid.UUID
    category_id: uuid.UUID
    category_name: str
    category_kind: CategoryKind
    amount: int


async def get_spending_breakdown(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    range_: RangeKind,
    now: datetime,
) -> SpendingBreakdownResponse:
    """Return category-level expense and income totals for a range

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        range_: Calendar period used for the breakdown totals
        now: Viewer-local timestamp used to derive current-period bounds

    Returns:
        Spending and income breakdown response with FX status
    """
    start, end = _current_period_bounds(range_, now.date())
    if not accounts:
        return _empty_spending_breakdown_response(range_)

    accounts_by_id = {account.id: account for account in accounts}
    rows = await _query_category_daily_totals(db, accounts_by_id, start, end)
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_conversion_rates(
        converter,
        rows,
        accounts_by_id,
        base_currency,
        start,
        end,
    )

    category_totals = await _convert_category_totals(rows, accounts_by_id, base_currency, converter)
    expense_entries, income_entries = _split_breakdown_entries(category_totals)
    expense_total, income_total = _breakdown_totals(expense_entries, income_entries)

    return SpendingBreakdownResponse(
        range=range_,
        expense=_dashboard_breakdown_entries(expense_entries, CategoryKind.EXPENSE),
        income=_dashboard_breakdown_entries(income_entries, CategoryKind.INCOME),
        expense_total=expense_total,
        income_total=income_total,
        fx_status=converter.get_status(),
    )


def _current_period_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return current-period date bounds for a dashboard range

    Args:
        range_: Calendar period requested by the dashboard
        today: Viewer-local current date

    Returns:
        Inclusive start and end dates for the current period
    """
    if range_ == "WTD":
        return today - timedelta(days=today.weekday()), today
    if range_ == "MTD":
        return date(today.year, today.month, 1), today
    if range_ == "QTD":
        quarter_month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, quarter_month, 1), today
    return date(today.year, 1, 1), today


def _empty_spending_breakdown_response(range_: RangeKind) -> SpendingBreakdownResponse:
    """Return an empty breakdown response for users without accounts

    Args:
        range_: Calendar period requested by the dashboard

    Returns:
        Empty spending breakdown response with a clean FX status
    """
    return SpendingBreakdownResponse(
        range=range_,
        expense=[],
        income=[],
        expense_total=0,
        income_total=0,
        fx_status=FxStatus(),
    )


async def _query_category_daily_totals(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    start: date,
    end: date,
) -> list[_CategoryDailyTotal]:
    """Return daily transaction totals grouped by account and category

    The query keeps account, date, and category on each aggregate row so
    foreign-currency totals can be converted before category entries are merged

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Grouped transaction totals for income and expense categories
    """
    # Aggregate daily income and expense totals across readable dashboard accounts
    query_result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id,
            Category.name,
            Category.kind,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(list(accounts_by_id)),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id, Category.id, Category.name, Category.kind),
    )
    return [
        _CategoryDailyTotal(
            transaction_date=row.dt,
            account_id=row.account_id,
            category_id=row.id,
            category_name=row.name,
            category_kind=row.kind,
            amount=int(row.total or 0),
        )
        for row in query_result
    ]


async def _prefetch_conversion_rates(
    converter: FxConverter,
    rows: list[_CategoryDailyTotal],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
) -> None:
    """Prefetch FX rates needed by category daily totals

    Args:
        converter: Request-scoped FX converter
        rows: Grouped category daily totals
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive rate start date
        end: Inclusive rate end date
    """
    row_currencies = {accounts_by_id[row.account_id].currency for row in rows}
    for currency in sorted(row_currencies - {base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )


async def _convert_category_totals(
    rows: list[_CategoryDailyTotal],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    converter: FxConverter,
) -> _CategoryTotals:
    """Convert grouped row totals into base-currency category totals

    Args:
        rows: Grouped category daily totals
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        converter: Request-scoped FX converter

    Returns:
        Category totals keyed by category ID
    """
    category_totals: _CategoryTotals = {}
    for row in rows:
        # Transaction.amount uses the account currency, while Transaction.currency is receipt metadata
        converted_amount = await converter.convert_minor_units(
            row.amount,
            base=accounts_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.transaction_date,
        )
        if converted_amount is None:
            continue

        name, kind, current_amount = category_totals.get(
            row.category_id,
            (row.category_name, row.category_kind, 0),
        )
        category_totals[row.category_id] = (name, kind, current_amount + converted_amount)
    return category_totals


def _split_breakdown_entries(
    category_totals: _CategoryTotals,
) -> tuple[list[CategoryBreakdownEntry], list[CategoryBreakdownEntry]]:
    """Split signed category totals into expense and income entries

    Args:
        category_totals: Category totals keyed by category ID

    Returns:
        Expense entries and income entries sorted largest-first
    """
    expense_entries: list[CategoryBreakdownEntry] = []
    income_entries: list[CategoryBreakdownEntry] = []
    for category_id, (name, kind, total) in category_totals.items():
        if total < 0:
            expense_entries.append(CategoryBreakdownEntry(
                category_id=category_id,
                name=name,
                category_kind=kind,
                amount=-total,
            ))
            continue

        if total > 0:
            income_entries.append(CategoryBreakdownEntry(
                category_id=category_id,
                name=name,
                category_kind=kind,
                amount=total,
            ))

    expense_entries.sort(key=lambda entry: (-entry.amount, entry.name))
    income_entries.sort(key=lambda entry: (-entry.amount, entry.name))
    return expense_entries, income_entries


def _breakdown_totals(
    expense_entries: list[CategoryBreakdownEntry],
    income_entries: list[CategoryBreakdownEntry],
) -> tuple[int, int]:
    """Return dashboard totals adjusted for category sign crossovers

    Args:
        expense_entries: Expense entries after sign-based splitting
        income_entries: Income entries after sign-based splitting

    Returns:
        Expense total and income total for the dashboard summary
    """
    expense_refunds = sum(entry.amount for entry in income_entries if entry.category_kind == CategoryKind.EXPENSE)
    income_losses = sum(entry.amount for entry in expense_entries if entry.category_kind == CategoryKind.INCOME)
    expense_total = max(sum(entry.amount for entry in expense_entries) - expense_refunds, 0)
    income_total = max(sum(entry.amount for entry in income_entries) - income_losses, 0)
    return expense_total, income_total


def _dashboard_breakdown_entries(
    entries: list[CategoryBreakdownEntry],
    kind: CategoryKind,
) -> list[CategoryBreakdownEntry]:
    """Return visible slices plus one Other slice for same-kind hidden rows

    Args:
        entries: Sorted breakdown entries for one side of the widget
        kind: Category kind represented by the visible list

    Returns:
        Visible entries with one compacted Other entry when needed
    """
    visible_entries = entries[:DASHBOARD_BREAKDOWN_CATEGORY_LIMIT]
    hidden_entries = entries[DASHBOARD_BREAKDOWN_CATEGORY_LIMIT:]
    flipped_hidden_entries = [entry for entry in hidden_entries if entry.category_kind != kind]
    other_amount = sum(entry.amount for entry in hidden_entries if entry.category_kind == kind)
    if other_amount <= 0:
        return [*visible_entries, *flipped_hidden_entries]

    return [
        *visible_entries,
        *flipped_hidden_entries,
        CategoryBreakdownEntry(
            category_id=uuid.uuid5(uuid.NAMESPACE_URL, f"dashboard-{kind.value}-other"),
            name="Other",
            category_kind=kind,
            amount=other_amount,
        ),
    ]


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Spending breakdown conversion uses this metadata to interpret category
    totals before converting them to the user's base currency

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    # Load exponent metadata for every currency needed by spending breakdown conversions
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in currency_result}
