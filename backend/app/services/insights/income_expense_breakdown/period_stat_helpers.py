"""Period stat loading helpers for the income/expense breakdown card"""

import uuid
from dataclasses import dataclass
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


@dataclass(frozen=True)
class CategoryPeriodStats:
    """Store signed category stats for a single period

    Attributes:
        name: Category display name
        category_kind: Original category kind
        signed_amount: Converted signed total for the period
        transaction_count: Number of transactions behind the signed amount
    """

    name: str
    category_kind: CategoryKind
    signed_amount: int
    transaction_count: int


CategoryPeriodStatsById = dict[uuid.UUID, CategoryPeriodStats]


async def get_income_expense_breakdown_period_stats(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[CategoryPeriodStatsById, FxStatus]:
    """Return converted signed category totals and transaction counts for a period

    Args:
        db: Active database session
        accounts: Accounts included in the insight summary
        base_currency: User base currency used for converted values
        from_date: Inclusive period start date
        to_date: Inclusive period end date

    Returns:
        Converted category period stats and FX conversion status
    """
    if not accounts:
        return {}, FxStatus()

    account_ids = [account.id for account in accounts]

    # Load category totals grouped by account currency and date so each amount can use the correct FX rate
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            Category.kind,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("transaction_count"),
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
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_breakdown_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    raw_stats: CategoryPeriodStatsById = {}

    # Convert each grouped total, then fold it into one signed total per category
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        current_stats = raw_stats.get(row.id, CategoryPeriodStats(row.name, row.kind, 0, 0))
        raw_stats[row.id] = CategoryPeriodStats(
            name=current_stats.name,
            category_kind=current_stats.category_kind,
            signed_amount=current_stats.signed_amount + converted_total,
            transaction_count=current_stats.transaction_count + int(row.transaction_count or 0),
        )

    return raw_stats, converter.get_status()


async def _prefetch_breakdown_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    """Prefetch FX rates required by category breakdown rows

    Args:
        converter: FX converter used by the breakdown calculation
        rows: Grouped transaction rows that may require FX conversion
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
