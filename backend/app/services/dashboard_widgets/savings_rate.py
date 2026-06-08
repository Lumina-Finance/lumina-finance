"""Savings-rate dashboard widget service"""
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import DASHBOARD_SAVINGS_HISTORY_MONTHS
from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.schemas.dashboard import MonthlyIncomeExpense
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter


async def get_savings_rate_history(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    now: datetime,
) -> tuple[list[MonthlyIncomeExpense], FxStatus]:
    """Return per-month income and expense totals for the savings-rate chart

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        now: Viewer-local timestamp used to derive the calendar window

    Returns:
        Oldest-first monthly income and expense history plus FX status
    """
    months_count = DASHBOARD_SAVINGS_HISTORY_MONTHS
    first_month = _months_before(now, months_count - 1)
    window_end = _first_of_next_month(now)

    months = _savings_rate_months(first_month, months_count)
    empty_history = [MonthlyIncomeExpense(month=month, income=0, expenses=0) for month in months]
    if not accounts:
        return empty_history, FxStatus()

    accounts_by_id = {account.id: account for account in accounts}
    result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id.label("category_id"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(list(accounts_by_id)),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= first_month,
            Transaction.dt < window_end,
        )
        .group_by(Transaction.dt, Transaction.account_id, Category.id),
    )
    rows = list(result)
    if not rows:
        return empty_history, FxStatus()

    row_currencies = {accounts_by_id[row.account_id].currency for row in rows}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *row_currencies},
        ),
    )
    for currency in sorted(row_currencies - {base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=first_month,
            end_date=window_end - timedelta(days=1),
        )

    totals = {month: {"income": 0, "expenses": 0} for month in months}
    category_totals: dict[tuple[date, uuid.UUID], int] = {}
    for row in rows:
        # Transaction.amount uses the account currency, while Transaction.currency is receipt metadata
        total = await converter.convert_minor_units(
            int(row.total or 0),
            base=accounts_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.dt,
        )
        if total is None:
            continue

        key = (date(row.dt.year, row.dt.month, 1), row.category_id)
        category_totals[key] = category_totals.get(key, 0) + total

    for (month, _category_id), total in category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    return (
        [
            MonthlyIncomeExpense(
                month=month,
                income=totals[month]["income"],
                expenses=totals[month]["expenses"],
            )
            for month in months
        ],
        converter.get_status(),
    )


def _months_before(now: datetime, count: int) -> date:
    """Return the first day of the month ``count`` months before ``now``

    Args:
        now: Viewer-local timestamp used as the reference month
        count: Number of full calendar months to move backwards

    Returns:
        First day of the target month
    """
    year, month = now.year, now.month
    for _ in range(count):
        if month == 1:
            year -= 1
            month = 12
        else:
            month -= 1
    return date(year, month, 1)


def _first_of_next_month(now: datetime) -> date:
    """Return the first day of the month immediately after ``now``

    Args:
        now: Viewer-local timestamp used as the reference month

    Returns:
        First day of the next calendar month
    """
    if now.month == 12:
        return date(now.year + 1, 1, 1)
    return date(now.year, now.month + 1, 1)


def _savings_rate_months(first_month: date, months_count: int) -> list[date]:
    """Build the ordered calendar months emitted by the savings-rate widget

    Args:
        first_month: First month in the history window
        months_count: Number of monthly history entries to emit

    Returns:
        Ordered list of first-of-month dates
    """
    months: list[date] = []
    year, month = first_month.year, first_month.month
    for _ in range(months_count):
        months.append(date(year, month, 1))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return months


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in currency_result}
