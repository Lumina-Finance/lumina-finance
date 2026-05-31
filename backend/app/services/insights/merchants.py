"""Shared merchant spending service for the insights page."""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import (
    InsightsMerchantDistributionResponse,
    InsightsMerchantRankingResponse,
    InsightsMerchantsResponse,
)
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter
from app.services.insights.common import previous_period_bounds

MERCHANT_DISTRIBUTION_LIMIT = 8
MERCHANT_RANKING_LIMIT = 10


@dataclass(frozen=True)
class MerchantSpendStats:
    name: str
    amount: int
    transaction_count: int


MerchantSpendStatsById = dict[uuid.UUID, MerchantSpendStats]
MerchantDistributionRow = tuple[str, str, int, int | None, int | None]
MerchantRankingRow = tuple[str, str, int, int, int | None]


async def _query_merchant_stats(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[MerchantSpendStatsById, FxStatus]:
    """Return converted net expense-kind spend and transaction counts by merchant."""
    if not accounts:
        return {}, FxStatus()

    account_ids = [account.id for account in accounts]
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
        currency_exponents=await _get_currency_exponents(
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

    return (
        {
            merchant_id: stats
            for merchant_id, stats in stats_by_id.items()
            if stats.amount > 0
        },
        converter.get_status(),
    )


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_merchant_rates(
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


def _combine_fx_statuses(current: FxStatus, previous: FxStatus) -> FxStatus:
    if current.state == "none":
        return previous
    if previous.state == "none":
        return current

    missing_pairs = [
        *current.missing_pairs,
        *[
            pair
            for pair in previous.missing_pairs
            if not any(existing.base == pair.base and existing.quote == pair.quote for existing in current.missing_pairs)
        ],
    ]
    if current.state == "complete" and previous.state == "complete":
        return FxStatus(state="complete")
    if current.state == "unavailable" and previous.state == "unavailable":
        return FxStatus(state="unavailable", missing_pairs=missing_pairs)
    return FxStatus(state="incomplete", missing_pairs=missing_pairs)


def _change_pct(current_amount: int, previous_amount: int) -> int | None:
    if previous_amount <= 0:
        return None
    return round(((current_amount - previous_amount) / previous_amount) * 100)


def _merchant_distribution_rows(
    current_stats_by_id: MerchantSpendStatsById,
    previous_stats_by_id: MerchantSpendStatsById,
) -> list[MerchantDistributionRow]:
    """Return top merchant rows plus one Other row for remaining spend."""
    ranked_entries = sorted(
        current_stats_by_id.items(),
        key=lambda entry: (-entry[1].amount, entry[1].name),
    )
    visible_entries = ranked_entries[:MERCHANT_DISTRIBUTION_LIMIT]
    remaining_entries = ranked_entries[MERCHANT_DISTRIBUTION_LIMIT:]

    rows: list[MerchantDistributionRow] = []
    for merchant_id, stats in visible_entries:
        previous_amount = previous_stats_by_id.get(merchant_id, MerchantSpendStats("", 0, 0)).amount
        rows.append((
            str(merchant_id),
            stats.name,
            stats.amount,
            _change_pct(stats.amount, previous_amount),
            stats.amount - previous_amount,
        ))

    other_amount = sum(stats.amount for _merchant_id, stats in remaining_entries)
    if other_amount > 0:
        rows.append(("other-merchants", "Other", other_amount, None, None))

    return rows


def _merchant_ranking_rows(
    current_stats_by_id: MerchantSpendStatsById,
    previous_stats_by_id: MerchantSpendStatsById,
) -> list[MerchantRankingRow]:
    """Return top merchant rows sorted by current spend."""
    ranked_entries = sorted(
        current_stats_by_id.items(),
        key=lambda entry: (-entry[1].amount, entry[1].name),
    )

    rows: list[MerchantRankingRow] = []
    for merchant_id, stats in ranked_entries[:MERCHANT_RANKING_LIMIT]:
        previous_amount = previous_stats_by_id.get(merchant_id, MerchantSpendStats("", 0, 0)).amount
        rows.append((
            str(merchant_id),
            stats.name,
            stats.amount,
            stats.transaction_count,
            _change_pct(stats.amount, previous_amount),
        ))
    return rows


async def get_merchants(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsMerchantsResponse:
    """Return shared merchant spend data for the insights merchant cards."""
    previous_from_date, previous_to_date = previous_period_bounds(from_date, to_date)
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        return InsightsMerchantsResponse(distribution=[], ranking=[])

    current_stats, current_fx_status = await _query_merchant_stats(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    previous_stats, previous_fx_status = await _query_merchant_stats(
        db,
        accounts,
        user.base_currency,
        previous_from_date,
        previous_to_date,
    )

    return InsightsMerchantsResponse(
        distribution=_merchant_distribution_rows(current_stats, previous_stats),
        ranking=_merchant_ranking_rows(current_stats, previous_stats),
        fx_status=_combine_fx_statuses(current_fx_status, previous_fx_status),
    )


async def get_merchant_distribution(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsMerchantDistributionResponse:
    """Return merchant spend rows for the insights merchant distribution card."""
    merchants = await get_merchants(db, user, from_date, to_date)
    return InsightsMerchantDistributionResponse(merchants=merchants.distribution)


async def get_merchant_ranking(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsMerchantRankingResponse:
    """Return merchant ranking rows for the insights merchant ranking card."""
    merchants = await get_merchants(db, user, from_date, to_date)
    return InsightsMerchantRankingResponse(merchants=merchants.ranking)
