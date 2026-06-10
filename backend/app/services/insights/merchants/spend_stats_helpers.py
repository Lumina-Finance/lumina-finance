"""Spend stat loading helpers for insights merchant cards"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents


@dataclass(frozen=True)
class MerchantSpendStats:
    """Store converted merchant spend stats for one period

    Attributes:
        name: Merchant display name
        amount: Positive spend amount
        transaction_count: Number of transactions behind the amount
    """

    name: str
    amount: int
    transaction_count: int


MerchantSpendStatsById = dict[uuid.UUID, MerchantSpendStats]


async def get_merchant_spend_stats(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[MerchantSpendStatsById, FxStatus]:
    """Return converted net expense-kind spend and transaction counts by merchant

    Args:
        db: Active database session
        accounts: Accounts included in the merchant insight summary
        base_currency: User base currency used for converted values
        from_date: Inclusive period start date
        to_date: Inclusive period end date

    Returns:
        Positive merchant spend stats and FX conversion status
    """
    if not accounts:
        fx_status = FxStatus()
        return {}, fx_status

    account_ids = [account.id for account in accounts]

    # Load merchant totals grouped by date and account currency so each amount can use the correct FX rate
    result = await db.execute(
        select(
            Merchant.id,
            Merchant.name,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("transaction_count"),
        )
        .join(Merchant, Transaction.merchant_id == Merchant.id)
        .join(Category, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Transaction.merchant_id.is_not(None),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Merchant.id, Merchant.name, Transaction.dt, Account.currency),
    )
    rows = result.all()
    converter = FxConverter(
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_merchant_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    stats_by_id: MerchantSpendStatsById = {}

    # Convert each grouped total, then net expense refunds against merchant spend
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        current_stats = stats_by_id.get(row.id, MerchantSpendStats(row.name, 0, 0))
        stats_by_id[row.id] = MerchantSpendStats(
            name=current_stats.name,
            amount=current_stats.amount - converted_total,
            transaction_count=current_stats.transaction_count + int(row.transaction_count or 0),
        )

    positive_stats_by_id = {
        merchant_id: stats
        for merchant_id, stats in stats_by_id.items()
        if stats.amount > 0
    }
    fx_status = converter.get_status()
    return positive_stats_by_id, fx_status


async def _prefetch_merchant_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    """Prefetch FX rates required by merchant spend rows

    Args:
        converter: FX converter used by the merchant insight calculation
        rows: Grouped merchant transaction rows that may require FX conversion
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
