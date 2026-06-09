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
from app.utils.dates import get_month_start_date, get_next_month_start_date, get_recent_month_start_dates


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
    months = get_recent_month_start_dates(now, months_count)
    first_month = months[0]
    window_end = get_next_month_start_date(now)

    empty_history = [MonthlyIncomeExpense(month=month, income=0, expenses=0) for month in months]
    if not accounts:
        fx_status = FxStatus()
        return empty_history, fx_status

    accounts_by_id = {account.id: account for account in accounts}
    account_ids = list(accounts_by_id)

    # Aggregate monthly income and expense category totals for readable dashboard accounts
    result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id.label("category_id"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= first_month,
            Transaction.dt < window_end,
        )
        .group_by(Transaction.dt, Transaction.account_id, Category.id),
    )
    monthly_category_rows = list(result)
    if not monthly_category_rows:
        fx_status = FxStatus()
        return empty_history, fx_status

    total_currencies = {accounts_by_id[row.account_id].currency for row in monthly_category_rows}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *total_currencies},
        ),
    )
    for currency in sorted(total_currencies - {base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=first_month,
            end_date=window_end - timedelta(days=1),
        )

    totals = {month: {"income": 0, "expenses": 0} for month in months}
    category_totals: dict[tuple[date, uuid.UUID], int] = {}

    # Transaction.amount uses the account currency, while Transaction.currency is receipt metadata
    for row in monthly_category_rows:
        total = await converter.convert_minor_units(
            int(row.total or 0),
            base=accounts_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.dt,
        )
        if total is None:
            continue

        key = (get_month_start_date(row.dt), row.category_id)
        category_totals[key] = category_totals.get(key, 0) + total

    # Net each category before assigning the signed result to income or expenses
    for (month, _category_id), total in category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    history = [
        MonthlyIncomeExpense(
            month=month,
            income=totals[month]["income"],
            expenses=totals[month]["expenses"],
        )
        for month in months
    ]
    fx_status = converter.get_status()
    return history, fx_status


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Savings-rate conversion uses this metadata to interpret monthly totals
    before converting them to the user's base currency

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    currency_codes = sorted(currencies)

    # Load exponent metadata for every currency needed by savings-rate conversions
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currency_codes)),
    )
    currency_exponents = {row.id: row.minor_unit_exponent for row in currency_result}
    return currency_exponents
