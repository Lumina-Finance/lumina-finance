"""Savings-rate trend service for the insights page"""

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
from app.utils.dates import (
    get_month_start_date,
    get_month_start_dates,
    get_shifted_month_start_date,
)

SAVINGS_RATE_TREND_MONTHS = 12

MonthlyCategoryTotalsByKey = dict[tuple[date, uuid.UUID], int]
MonthlySavingsRateTotals = dict[date, dict[str, int]]


def _get_inclusive_month_count(start_month: date, end_month: date) -> int:
    """Return the number of months including both boundary months

    Args:
        start_month: First month start in the range
        end_month: Last month start in the range

    Returns:
        Inclusive number of months between the start and end months
    """
    # Count both boundary months so the response includes the visible start and current month
    month_count = ((end_month.year - start_month.year) * 12) + (end_month.month - start_month.month) + 1
    return month_count


async def _get_first_activity_month(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_end: date,
) -> date | None:
    """Return the first month with income or expense activity before a window end

    Args:
        db: Active database session
        account_ids: Account IDs included in the savings-rate trend
        window_end: Exclusive activity lookup end date

    Returns:
        First activity month, or None when there is no matching activity
    """
    # Find the earliest income or expense transaction before the trend window end
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
    first_activity_month = get_month_start_date(first_activity) if first_activity else None
    return first_activity_month


async def _get_converted_monthly_category_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    start_month: date,
    window_end: date,
) -> tuple[MonthlyCategoryTotalsByKey, FxStatus]:
    """Return converted monthly category totals before sign classification

    Args:
        db: Active database session
        accounts: Accounts included in the savings-rate trend
        base_currency: User base currency used for converted values
        start_month: Inclusive month start for the trend window
        window_end: Exclusive trend window end date

    Returns:
        Converted monthly category totals and FX conversion status
    """
    if not accounts:
        monthly_totals: MonthlyCategoryTotalsByKey = {}
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

    totals: MonthlyCategoryTotalsByKey = {}

    # Convert grouped totals into the user's base currency and merge rows by month and category
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

    fx_status = converter.get_status()
    return totals, fx_status


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
    exponents_by_currency = {row.id: row.minor_unit_exponent for row in result}
    return exponents_by_currency


async def _prefetch_savings_rate_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    """Prefetch FX rates required by savings-rate trend rows

    Args:
        converter: FX converter used by the savings-rate trend calculation
        rows: Grouped savings-rate trend transaction rows that may require FX conversion
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
        start_date, end_date = ranges.get(currency, (row.date, row.date))
        ranges[currency] = (min(start_date, row.date), max(end_date, row.date))

    for currency, (start_date, end_date) in sorted(ranges.items()):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


def _build_empty_savings_rate_trend_response() -> InsightsSavingsRateTrendResponse:
    """Return an empty savings-rate trend response

    Returns:
        Savings-rate trend response payload with no points
    """
    response = InsightsSavingsRateTrendResponse(points=[])
    return response


def _get_monthly_savings_rate_totals(months: list[date], monthly_category_totals: MonthlyCategoryTotalsByKey) -> MonthlySavingsRateTotals:
    """Return monthly income and expense totals from signed category totals

    Args:
        months: Month starts included in the response
        monthly_category_totals: Converted monthly category totals keyed by month and category

    Returns:
        Income and expense totals keyed by month
    """
    totals = {month: {"income": 0, "expenses": 0} for month in months}

    # Classify signed category totals into monthly income and expense totals
    for (month, _category_id), total in monthly_category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    return totals


def _build_savings_rate_trend_response(
    months: list[date],
    totals: MonthlySavingsRateTotals,
    fx_status: FxStatus,
) -> InsightsSavingsRateTrendResponse:
    """Return savings-rate trend response from monthly totals

    Args:
        months: Month starts included in the response
        totals: Income and expense totals keyed by month
        fx_status: FX conversion status from monthly total loading

    Returns:
        Savings-rate trend response payload
    """
    points = [
        (
            month,
            totals[month]["income"],
            totals[month]["expenses"],
        )
        for month in months
    ]
    response = InsightsSavingsRateTrendResponse(points=points, fx_status=fx_status)
    return response


async def get_savings_rate_trend(
    db: AsyncSession,
    user: User,
    now: datetime,
) -> InsightsSavingsRateTrendResponse:
    """Return latest available sign-directed monthly totals for savings-rate trend

    Args:
        db: Active database session
        user: User requesting the savings-rate trend insight
        now: Current datetime in the user's timezone

    Returns:
        Savings-rate trend response payload
    """
    # Load accounts the user can read before finding monthly trend activity
    accounts = await get_accessible_accounts(db, user)
    account_ids = [account.id for account in accounts]
    if not account_ids:
        response = _build_empty_savings_rate_trend_response()
        return response

    current_month = get_month_start_date(now.date())
    window_end = get_shifted_month_start_date(current_month, 1)
    first_activity_month = await _get_first_activity_month(db, account_ids, window_end)
    if first_activity_month is None:
        response = _build_empty_savings_rate_trend_response()
        return response

    earliest_visible_month = get_shifted_month_start_date(current_month, -(SAVINGS_RATE_TREND_MONTHS - 1))
    start_month = max(first_activity_month, earliest_visible_month)
    month_count = _get_inclusive_month_count(start_month, current_month)
    months = get_month_start_dates(start_month, month_count)
    monthly_category_totals, fx_status = await _get_converted_monthly_category_totals(
        db,
        accounts,
        user.base_currency,
        start_month,
        window_end,
    )
    totals = _get_monthly_savings_rate_totals(months, monthly_category_totals)
    response = _build_savings_rate_trend_response(months, totals, fx_status)
    return response
