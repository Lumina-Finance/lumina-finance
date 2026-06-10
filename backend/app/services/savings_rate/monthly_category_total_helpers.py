"""Savings-rate monthly category total helpers"""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents

SavingsRateMonthlyCategoryTotalsByKey = dict[tuple[date, uuid.UUID], int]


async def get_converted_savings_rate_monthly_category_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    start_month: date,
    window_end: date,
    *,
    prefetch_start_date: date | None = None,
    prefetch_end_date: date | None = None,
) -> tuple[SavingsRateMonthlyCategoryTotalsByKey, FxStatus]:
    """Return converted monthly category totals before sign classification

    Args:
        db: Active database session
        accounts: Accounts included in the savings-rate calculation
        base_currency: User base currency used for converted values
        start_month: Inclusive month start for the savings-rate window
        window_end: Exclusive savings-rate window end date
        prefetch_start_date: Optional inclusive rate prefetch start date
        prefetch_end_date: Optional inclusive rate prefetch end date

    Returns:
        Converted monthly category totals and FX conversion status
    """
    if not accounts:
        monthly_totals: SavingsRateMonthlyCategoryTotalsByKey = {}
        fx_status = FxStatus()
        return monthly_totals, fx_status

    account_ids = [account.id for account in accounts]
    month_start_expr = func.date_trunc("month", Transaction.dt).label("month_start")

    # Load monthly category totals grouped by account currency and transaction date for FX conversion
    result = await db.execute(
        select(
            month_start_expr,
            Category.id.label("category_id"),
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= start_month,
            Transaction.dt < window_end,
        )
        .group_by(month_start_expr, Category.id, Transaction.dt, Account.currency),
    )
    monthly_category_rows = result.all()
    converter = FxConverter(
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_savings_rate_rates(
        converter,
        monthly_category_rows=monthly_category_rows,
        base_currency=base_currency,
        prefetch_start_date=prefetch_start_date,
        prefetch_end_date=prefetch_end_date,
    )

    totals: SavingsRateMonthlyCategoryTotalsByKey = {}

    # Convert grouped totals into the user's base currency and merge rows by month and category
    for row in monthly_category_rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        month = row.month_start.date() if hasattr(row.month_start, "date") else row.month_start
        key = (month, row.category_id)
        totals[key] = totals.get(key, 0) + converted_total

    fx_status = converter.get_status()
    return totals, fx_status


async def _prefetch_savings_rate_rates(
    converter: FxConverter,
    *,
    monthly_category_rows,
    base_currency: str,
    prefetch_start_date: date | None,
    prefetch_end_date: date | None,
) -> None:
    """Prefetch FX rates required by savings-rate monthly category totals

    Args:
        converter: FX converter used by the savings-rate calculation
        monthly_category_rows: Grouped monthly category totals that may require FX conversion
        base_currency: User base currency used for converted values
        prefetch_start_date: Optional inclusive rate prefetch start date
        prefetch_end_date: Optional inclusive rate prefetch end date

    Returns:
        None
    """
    if prefetch_start_date is not None and prefetch_end_date is not None:
        await _prefetch_savings_rate_window_rates(
            converter,
            monthly_category_rows=monthly_category_rows,
            base_currency=base_currency,
            prefetch_start_date=prefetch_start_date,
            prefetch_end_date=prefetch_end_date,
        )
        return

    ranges: dict[str, tuple[date, date]] = {}

    # Build one date range per foreign currency to avoid prefetching each row individually
    for row in monthly_category_rows:
        currency = row.account_currency
        if currency == base_currency:
            continue
        start_date, end_date = ranges.get(currency, (row.date, row.date))
        ranges[currency] = (min(start_date, row.date), max(end_date, row.date))

    for currency, (start_date, end_date) in sorted(ranges.items()):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


async def _prefetch_savings_rate_window_rates(
    converter: FxConverter,
    *,
    monthly_category_rows,
    base_currency: str,
    prefetch_start_date: date,
    prefetch_end_date: date,
) -> None:
    """Prefetch one explicit FX rate window for savings-rate foreign currencies

    Args:
        converter: FX converter used by the savings-rate calculation
        monthly_category_rows: Grouped monthly category totals that may require FX conversion
        base_currency: User base currency used for converted values
        prefetch_start_date: Inclusive rate prefetch start date
        prefetch_end_date: Inclusive rate prefetch end date
    """
    foreign_currencies = {
        row.account_currency
        for row in monthly_category_rows
        if row.account_currency != base_currency
    }
    for currency in sorted(foreign_currencies):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=prefetch_start_date,
            end_date=prefetch_end_date,
        )
