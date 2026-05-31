"""Shared merchant spending service for the insights page."""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.insights import (
    InsightsMerchantDistributionResponse,
    InsightsMerchantRankingResponse,
    InsightsMerchantsResponse,
)
from app.services.insights.common import get_base_currency_accounts, previous_period_bounds

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
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> MerchantSpendStatsById:
    """Return net expense-kind spend and transaction counts by merchant."""
    result = await db.execute(
        select(
            Merchant.id,
            Merchant.name,
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("transaction_count"),
        )
        .join(Merchant, Transaction.merchant_id == Merchant.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Transaction.merchant_id.is_not(None),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Merchant.id, Merchant.name),
    )

    stats_by_id: MerchantSpendStatsById = {}
    for row in result:
        amount = max(-int(row.total or 0), 0)
        if amount > 0:
            stats_by_id[row.id] = MerchantSpendStats(
                name=row.name,
                amount=amount,
                transaction_count=int(row.transaction_count or 0),
            )
    return stats_by_id


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
    base_currency_accounts = await get_base_currency_accounts(db, user)
    account_ids = [account.id for account in base_currency_accounts]

    if not account_ids:
        return InsightsMerchantsResponse(distribution=[], ranking=[])

    current_stats = await _query_merchant_stats(db, account_ids, from_date, to_date)
    previous_stats = await _query_merchant_stats(db, account_ids, previous_from_date, previous_to_date)

    return InsightsMerchantsResponse(
        distribution=_merchant_distribution_rows(current_stats, previous_stats),
        ranking=_merchant_ranking_rows(current_stats, previous_stats),
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
