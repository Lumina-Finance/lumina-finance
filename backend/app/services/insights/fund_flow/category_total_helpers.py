"""Category total loading helpers for fund-flow insights"""

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
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter

FundFlowCategoryTotals = dict[uuid.UUID, tuple[str, CategoryKind, int]]


@dataclass(frozen=True)
class ConvertedFundFlowCategoryTotals:
    """Store converted fund-flow category totals and FX status

    Attributes:
        category_totals: Converted category totals keyed by category ID
        fx_status: FX conversion status from category total conversion
    """

    category_totals: FundFlowCategoryTotals
    fx_status: FxStatus


async def get_converted_fund_flow_category_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> ConvertedFundFlowCategoryTotals:
    """Return converted fund-flow category totals for an inclusive date range

    Args:
        db: Active database session
        accounts: Accounts included in the fund-flow insight
        base_currency: User base currency used for converted values
        from_date: Inclusive fund-flow range start date
        to_date: Inclusive fund-flow range end date

    Returns:
        Converted category totals and FX conversion status
    """
    account_ids = [account.id for account in accounts]

    # Load category totals grouped by account currency and date for FX conversion
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            Category.kind,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
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
    await _prefetch_fund_flow_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    category_totals = await _get_converted_category_totals(
        rows=rows,
        converter=converter,
        base_currency=base_currency,
    )
    converted_totals = ConvertedFundFlowCategoryTotals(
        category_totals=category_totals,
        fx_status=converter.get_status(),
    )
    return converted_totals


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


async def _prefetch_fund_flow_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    """Prefetch FX rates required by fund-flow rows

    Args:
        converter: FX converter used by the fund-flow insight calculation
        rows: Grouped fund-flow transaction rows that may require FX conversion
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


async def _get_converted_category_totals(
    *,
    rows,
    converter: FxConverter,
    base_currency: str,
) -> FundFlowCategoryTotals:
    """Return converted fund-flow category totals keyed by category ID

    Args:
        rows: Grouped fund-flow transaction rows
        converter: FX converter used by the fund-flow insight calculation
        base_currency: User base currency used for converted values

    Returns:
        Non-zero converted category totals keyed by category ID
    """
    totals: FundFlowCategoryTotals = {}

    # Convert each grouped total and merge rows by category before sign classification
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        name, kind, current_total = totals.get(row.id, (row.name, row.kind, 0))
        totals[row.id] = (name, kind, current_total + converted_total)

    category_totals = {
        category_id: (name, kind, amount)
        for category_id, (name, kind, amount) in totals.items()
        if amount
    }
    return category_totals
