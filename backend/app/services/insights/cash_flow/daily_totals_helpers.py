"""Helpers for loading daily cash-flow totals"""

from datetime import date

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter

DailyCashFlowTotalsByDate = dict[date, tuple[int, int]]

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"


async def get_cash_flow_daily_totals(
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
        daily_totals: DailyCashFlowTotalsByDate = {}
        fx_status = FxStatus()
        return daily_totals, fx_status

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
