"""Cash-flow service for the insights page"""

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
CashFlowBucket = tuple[date, date]
CashFlowBucketRow = tuple[date, date, int, int]
DailyCashFlowTotalsByDate = dict[date, tuple[int, int]]

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


def _get_cash_flow_granularity(from_date: date, to_date: date) -> CashFlowGranularity:
    """Return the bucket granularity for a cash-flow date range

    Args:
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Bucket granularity used for the response rows
    """
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _get_cash_flow_bucket_key(target: date, granularity: CashFlowGranularity) -> tuple[int, ...]:
    """Return the grouping key for a cash-flow bucket date

    Args:
        target: Date being assigned to a bucket
        granularity: Bucket granularity used for the selected range

    Returns:
        Tuple key representing the target date bucket
    """
    if granularity == "day":
        bucket_key = (target.year, target.month, target.day)
    elif granularity == "week":
        iso_year, iso_week, _weekday = target.isocalendar()
        bucket_key = (iso_year, iso_week)
    else:
        bucket_key = (target.year, target.month)
    return bucket_key


def _get_cash_flow_buckets(from_date: date, to_date: date) -> list[CashFlowBucket]:
    """Return inclusive cash-flow bucket ranges for the selected date range

    Args:
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Inclusive bucket start and end dates for the response rows
    """
    granularity = _get_cash_flow_granularity(from_date, to_date)
    buckets: list[CashFlowBucket] = []
    bucket_start = from_date
    current_key = _get_cash_flow_bucket_key(from_date, granularity)
    cursor = from_date

    # Walk the range and close a bucket when the granularity key changes
    while cursor <= to_date:
        bucket_key = _get_cash_flow_bucket_key(cursor, granularity)
        if bucket_key != current_key:
            buckets.append((bucket_start, cursor - timedelta(days=1)))
            bucket_start = cursor
            current_key = bucket_key
        cursor += timedelta(days=1)

    buckets.append((bucket_start, to_date))
    return buckets


async def _query_daily_cash_flow(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[DailyCashFlowTotalsByDate, FxStatus]:
    """Return converted daily inflow and outflow totals for cash-flow rows

    Args:
        db: Active database session
        accounts: Accounts included in the cash-flow insight
        base_currency: User base currency used for converted values
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Daily base-currency cash-flow totals and FX conversion status
    """
    if not accounts:
        fx_status = FxStatus()
        return {}, fx_status

    account_ids = [account.id for account in accounts]

    # Load daily inflow and outflow totals grouped by account currency for FX conversion
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

    daily_totals: DailyCashFlowTotalsByDate = {}

    # Convert grouped totals into the user's base currency and merge account rows by date
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

    fx_status = converter.get_status()
    return daily_totals, fx_status


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


async def _prefetch_cash_flow_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    """Prefetch FX rates required by cash-flow rows

    Args:
        converter: FX converter used by the cash-flow insight calculation
        rows: Grouped cash-flow transaction rows that may require FX conversion
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


def _get_cash_flow_bucket_rows(
    buckets: list[CashFlowBucket],
    daily_totals: DailyCashFlowTotalsByDate,
) -> list[CashFlowBucketRow]:
    """Return cash-flow response rows for bucket ranges

    Args:
        buckets: Inclusive bucket ranges used by the response
        daily_totals: Daily inflow and outflow totals keyed by date

    Returns:
        Cash-flow bucket rows containing date range, inflow, and outflow
    """
    cash_flow_rows: list[CashFlowBucketRow] = []

    # Sum daily totals into each bucket so the response granularity matches the selected range
    for bucket_start, bucket_end in buckets:
        inflow = 0
        outflow = 0
        cursor = bucket_start
        while cursor <= bucket_end:
            day_inflow, day_outflow = daily_totals.get(cursor, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            cursor += timedelta(days=1)
        cash_flow_rows.append((bucket_start, bucket_end, inflow, outflow))
    return cash_flow_rows


async def get_cash_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsCashFlowResponse:
    """Return inflow and outflow buckets for the cash-flow card

    Args:
        db: Active database session
        user: User requesting the cash-flow insight
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Cash-flow response payload
    """
    # Load accounts the user can read before aggregating cash-flow totals
    accounts = await get_accessible_accounts(db, user)
    if not accounts:
        response = InsightsCashFlowResponse(points=[])
        return response

    buckets = _get_cash_flow_buckets(from_date, to_date)
    daily_totals, fx_status = await _query_daily_cash_flow(db, accounts, user.base_currency, from_date, to_date)
    if not any(inflow > 0 or outflow > 0 for inflow, outflow in daily_totals.values()):
        response = InsightsCashFlowResponse(points=[], fx_status=fx_status)
        return response

    cash_flow_rows = _get_cash_flow_bucket_rows(buckets, daily_totals)
    response = InsightsCashFlowResponse(points=cash_flow_rows, fx_status=fx_status)
    return response
