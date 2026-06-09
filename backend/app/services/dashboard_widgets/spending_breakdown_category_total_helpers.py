"""Spending breakdown category total helpers"""

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
from app.services.dashboard_widgets.spending_breakdown_response_helpers import (
    SpendingBreakdownCategoryTotal,
    SpendingBreakdownCategoryTotalsById,
)
from app.services.fx import FxConverter


@dataclass(frozen=True, slots=True)
class ConvertedSpendingBreakdownCategoryTotals:
    """Converted spending breakdown category totals and FX status

    Attributes:
        category_totals: Converted totals keyed by category ID
        fx_status: Status from currency conversion attempts
    """

    category_totals: SpendingBreakdownCategoryTotalsById
    fx_status: FxStatus


@dataclass(frozen=True, slots=True)
class _CategoryDailyTotal:
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


async def get_converted_spending_breakdown_category_totals(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
) -> ConvertedSpendingBreakdownCategoryTotals:
    """Return converted category totals and FX status for a spending breakdown

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Converted category totals plus FX conversion status
    """
    category_daily_totals = await _query_category_daily_totals(db, accounts_by_id, start, end)
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts_by_id.values())},
        ),
    )
    await _prefetch_conversion_rates(
        converter,
        category_daily_totals,
        accounts_by_id,
        base_currency,
        start,
        end,
    )
    category_totals = await _convert_category_totals(
        category_daily_totals,
        accounts_by_id,
        base_currency,
        converter,
    )
    converted_category_totals = ConvertedSpendingBreakdownCategoryTotals(
        category_totals=category_totals,
        fx_status=converter.get_status(),
    )
    return converted_category_totals


async def _query_category_daily_totals(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    start: date,
    end: date,
) -> list[_CategoryDailyTotal]:
    """Return daily transaction totals grouped by account and category

    The query keeps account, date, and category on each aggregate row so
    foreign-currency totals can be converted before categories are merged

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Grouped transaction totals for income and expense categories
    """
    account_ids = list(accounts_by_id)

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
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id, Category.id, Category.name, Category.kind),
    )
    category_daily_totals = [
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
    return category_daily_totals


async def _prefetch_conversion_rates(
    converter: FxConverter,
    category_daily_totals: list[_CategoryDailyTotal],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
) -> None:
    """Prefetch FX rates needed by category daily totals

    Args:
        converter: Request-scoped FX converter
        category_daily_totals: Grouped category daily totals
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive rate start date
        end: Inclusive rate end date
    """
    row_currencies = {accounts_by_id[row.account_id].currency for row in category_daily_totals}
    for currency in sorted(row_currencies - {base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )


async def _convert_category_totals(
    category_daily_totals: list[_CategoryDailyTotal],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    converter: FxConverter,
) -> SpendingBreakdownCategoryTotalsById:
    """Convert grouped row totals into base-currency category totals

    Args:
        category_daily_totals: Grouped category daily totals
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        converter: Request-scoped FX converter

    Returns:
        Category totals keyed by category ID
    """
    category_totals: SpendingBreakdownCategoryTotalsById = {}

    # Convert account-currency rows before merging totals by category
    for row in category_daily_totals:
        converted_amount = await converter.convert_minor_units(
            row.amount,
            base=accounts_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.transaction_date,
        )
        if converted_amount is None:
            continue

        current_category_total = category_totals.get(row.category_id)
        current_amount = current_category_total.amount if current_category_total else 0
        category_total = SpendingBreakdownCategoryTotal(
            name=row.category_name,
            kind=row.category_kind,
            amount=current_amount + converted_amount,
        )
        category_totals[row.category_id] = category_total
    return category_totals


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
    currency_codes = sorted(currencies)

    # Load exponent metadata for every currency needed by spending breakdown conversions
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currency_codes)),
    )
    currency_exponents = {row.id: row.minor_unit_exponent for row in currency_result}
    return currency_exponents
