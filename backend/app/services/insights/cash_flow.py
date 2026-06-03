"""Cash-flow service for the insights page."""

from datetime import date, timedelta
from typing import Literal

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsCashFlowResponse
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter

CashFlowGranularity = Literal["day", "week", "month"]

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


def _get_granularity(from_date: date, to_date: date) -> CashFlowGranularity:
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _bucket_key(target: date, granularity: CashFlowGranularity) -> tuple[int, ...]:
    if granularity == "day":
        return (target.year, target.month, target.day)
    if granularity == "week":
        iso_year, iso_week, _weekday = target.isocalendar()
        return (iso_year, iso_week)
    return (target.year, target.month)


def _build_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    granularity = _get_granularity(from_date, to_date)
    buckets: list[tuple[date, date]] = []
    bucket_start = from_date
    current_key = _bucket_key(from_date, granularity)
    cursor = from_date

    while cursor <= to_date:
        key = _bucket_key(cursor, granularity)
        if key != current_key:
            buckets.append((bucket_start, cursor - timedelta(days=1)))
            bucket_start = cursor
            current_key = key
        cursor += timedelta(days=1)

    buckets.append((bucket_start, to_date))
    return buckets


async def _query_daily_cash_flow(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[dict[date, tuple[int, int]], FxStatus]:
    if not accounts:
        return {}, FxStatus()

    account_ids = [account.id for account in accounts]
    result = await db.execute(
        select(
            Transaction.dt.label("date"),
            Transaction.account_id,
            Account.currency.label("account_currency"),
            func.coalesce(
                func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)),
                0,
            ).label("inflow"),
            func.coalesce(
                func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0)),
                0,
            ).label("outflow"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
            or_(
                Category.kind.in_((CategoryKind.INCOME, CategoryKind.EXPENSE)),
                (
                    (Category.kind == CategoryKind.TRANSFER)
                    & (Category.name != _BALANCE_ADJUSTMENT_CATEGORY_NAME)
                ),
            ),
        )
        .group_by(Transaction.dt, Transaction.account_id, Account.currency)
        .order_by(Transaction.dt),
    )
    rows = result.all()
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_cash_flow_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    daily_totals: dict[date, tuple[int, int]] = {}
    for row in rows:
        converted_inflow = await converter.convert_minor_units(
            int(row.inflow or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        converted_outflow = await converter.convert_minor_units(
            int(row.outflow or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_inflow is None and converted_outflow is None:
            continue

        current_inflow, current_outflow = daily_totals.get(row.date, (0, 0))
        daily_totals[row.date] = (
            current_inflow + (converted_inflow or 0),
            current_outflow + (converted_outflow or 0),
        )

    return daily_totals, converter.get_status()


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_cash_flow_rates(
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


def _bucket_points(
    buckets: list[tuple[date, date]],
    daily_totals: dict[date, tuple[int, int]],
) -> list[tuple[date, date, int, int]]:
    points: list[tuple[date, date, int, int]] = []
    for bucket_start, bucket_end in buckets:
        inflow = 0
        outflow = 0
        cursor = bucket_start
        while cursor <= bucket_end:
            day_inflow, day_outflow = daily_totals.get(cursor, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            cursor += timedelta(days=1)
        points.append((bucket_start, bucket_end, inflow, outflow))
    return points


async def get_cash_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsCashFlowResponse:
    """Return inflow and outflow buckets for the cash-flow card."""
    accounts = await get_accessible_accounts(db, user)
    if not accounts:
        return InsightsCashFlowResponse(points=[])

    buckets = _build_buckets(from_date, to_date)
    daily_totals, fx_status = await _query_daily_cash_flow(db, accounts, user.base_currency, from_date, to_date)
    if not any(inflow > 0 or outflow > 0 for inflow, outflow in daily_totals.values()):
        return InsightsCashFlowResponse(points=[], fx_status=fx_status)

    return InsightsCashFlowResponse(points=_bucket_points(buckets, daily_totals), fx_status=fx_status)
