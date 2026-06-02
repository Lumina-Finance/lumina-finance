"""Savings-rate trend service for the insights page."""

import uuid
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsSavingsRateTrendResponse
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter

SAVINGS_RATE_TREND_MONTHS = 12


def _month_start(target: date) -> date:
    return date(target.year, target.month, 1)


def _add_months(target: date, months: int) -> date:
    month_index = (target.year * 12) + (target.month - 1) + months
    return date(month_index // 12, (month_index % 12) + 1, 1)


def _build_months(start_month: date, end_month: date) -> list[date]:
    months: list[date] = []
    cursor = start_month
    while cursor <= end_month:
        months.append(cursor)
        cursor = _add_months(cursor, 1)
    return months


async def _first_activity_month(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_end: date,
) -> date | None:
    result = await db.execute(
        select(func.min(Transaction.dt))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt < window_end,
        ),
    )
    first_activity = result.scalar_one_or_none()
    return _month_start(first_activity) if first_activity else None


async def _query_monthly_category_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    start_month: date,
    window_end: date,
) -> tuple[dict[tuple[date, uuid.UUID], int], FxStatus]:
    """Return converted monthly totals by category before sign classification."""
    if not accounts:
        return {}, FxStatus()

    account_ids = [account.id for account in accounts]
    month_start_expr = func.date_trunc("month", Transaction.dt).label("month_start")
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
    rows = result.all()
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_savings_rate_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    totals: dict[tuple[date, uuid.UUID], int] = {}
    for row in rows:
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

    return totals, converter.get_status()


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_savings_rate_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    ranges: dict[str, tuple[date, date]] = {}
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


async def get_savings_rate_trend(
    db: AsyncSession,
    user: User,
    now: datetime,
) -> InsightsSavingsRateTrendResponse:
    """Return latest available sign-directed monthly totals for savings-rate trend."""
    accounts = await get_accessible_accounts(db, user)
    account_ids = [account.id for account in accounts]
    if not account_ids:
        return InsightsSavingsRateTrendResponse(points=[])

    current_month = _month_start(now.date())
    window_end = _add_months(current_month, 1)
    first_activity_month = await _first_activity_month(db, account_ids, window_end)
    if first_activity_month is None:
        return InsightsSavingsRateTrendResponse(points=[])

    earliest_visible_month = _add_months(current_month, -(SAVINGS_RATE_TREND_MONTHS - 1))
    start_month = max(first_activity_month, earliest_visible_month)
    months = _build_months(start_month, current_month)
    totals = {month: {"income": 0, "expenses": 0} for month in months}
    monthly_category_totals, fx_status = await _query_monthly_category_totals(
        db,
        accounts,
        user.base_currency,
        start_month,
        window_end,
    )

    for (month, _category_id), total in monthly_category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    return InsightsSavingsRateTrendResponse(
        points=[
            (
                month,
                totals[month]["income"],
                totals[month]["expenses"],
            )
            for month in months
        ],
        fx_status=fx_status,
    )
