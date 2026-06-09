"""Shared merchant spending service for the insights page"""

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
    InsightsComparisonPeriod,
    InsightsMerchantDistributionResponse,
    InsightsMerchantRankingResponse,
    InsightsMerchantsResponse,
)
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter
from app.services.insights.common import comparison_period_bounds

MERCHANT_DISTRIBUTION_LIMIT = 8
MERCHANT_RANKING_LIMIT = 10


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
MerchantDistributionRow = tuple[str, str, int, int | None, int | None]
MerchantRankingRow = tuple[str, str, int, int, int | None]


async def _query_merchant_stats(
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
    return {row.id: row.minor_unit_exponent for row in result}


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


def _combine_fx_statuses(current: FxStatus, previous: FxStatus) -> FxStatus:
    """Return one FX status for current and comparison period calculations

    Args:
        current: FX status from the selected period
        previous: FX status from the comparison period

    Returns:
        Combined FX status with duplicate missing pairs removed
    """
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
        fx_status = FxStatus(state="complete")
        return fx_status
    if current.state == "unavailable" and previous.state == "unavailable":
        fx_status = FxStatus(state="unavailable", missing_pairs=missing_pairs)
        return fx_status
    fx_status = FxStatus(state="incomplete", missing_pairs=missing_pairs)
    return fx_status


def _change_pct(current_amount: int, previous_amount: int) -> int | None:
    """Return percentage change from a previous amount

    Args:
        current_amount: Current-period merchant spend
        previous_amount: Comparison-period merchant spend

    Returns:
        Rounded percentage change, or None when there is no positive previous amount
    """
    if previous_amount <= 0:
        return None
    return round(((current_amount - previous_amount) / previous_amount) * 100)


def _merchant_distribution_rows(
    current_stats_by_id: MerchantSpendStatsById,
    previous_stats_by_id: MerchantSpendStatsById,
) -> list[MerchantDistributionRow]:
    """Return top merchant rows plus one Other row for remaining spend

    Args:
        current_stats_by_id: Selected-period merchant spend stats keyed by merchant ID
        previous_stats_by_id: Comparison-period merchant spend stats keyed by merchant ID

    Returns:
        Merchant distribution rows for the response
    """
    ranked_entries = sorted(
        current_stats_by_id.items(),
        key=lambda entry: (-entry[1].amount, entry[1].name),
    )
    visible_entries = ranked_entries[:MERCHANT_DISTRIBUTION_LIMIT]
    remaining_entries = ranked_entries[MERCHANT_DISTRIBUTION_LIMIT:]

    rows: list[MerchantDistributionRow] = []

    # Build visible merchant rows with comparison movement values
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
    """Return top merchant rows sorted by current spend

    Args:
        current_stats_by_id: Selected-period merchant spend stats keyed by merchant ID
        previous_stats_by_id: Comparison-period merchant spend stats keyed by merchant ID

    Returns:
        Merchant ranking rows for the response
    """
    ranked_entries = sorted(
        current_stats_by_id.items(),
        key=lambda entry: (-entry[1].amount, entry[1].name),
    )

    rows: list[MerchantRankingRow] = []

    # Build capped ranking rows with transaction counts and comparison percentage
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
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsMerchantsResponse:
    """Return shared merchant spend data for the insights merchant cards

    Args:
        db: Active database session
        user: User requesting the merchant insight summary
        from_date: Inclusive selected period start date
        to_date: Inclusive selected period end date
        comparison_period: Comparison period used for movement values

    Returns:
        Shared merchant response payload
    """
    previous_from_date, previous_to_date = comparison_period_bounds(from_date, to_date, comparison_period)
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        response = InsightsMerchantsResponse(distribution=[], ranking=[])
        return response

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

    response = InsightsMerchantsResponse(
        distribution=_merchant_distribution_rows(current_stats, previous_stats),
        ranking=_merchant_ranking_rows(current_stats, previous_stats),
        fx_status=_combine_fx_statuses(current_fx_status, previous_fx_status),
    )
    return response


async def get_merchant_distribution(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsMerchantDistributionResponse:
    """Return merchant spend rows for the insights merchant distribution card

    Args:
        db: Active database session
        user: User requesting the merchant insight summary
        from_date: Inclusive selected period start date
        to_date: Inclusive selected period end date
        comparison_period: Comparison period used for movement values

    Returns:
        Merchant distribution response payload
    """
    merchants = await get_merchants(db, user, from_date, to_date, comparison_period)
    response = InsightsMerchantDistributionResponse(merchants=merchants.distribution)
    return response


async def get_merchant_ranking(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsMerchantRankingResponse:
    """Return merchant ranking rows for the insights merchant ranking card

    Args:
        db: Active database session
        user: User requesting the merchant insight summary
        from_date: Inclusive selected period start date
        to_date: Inclusive selected period end date
        comparison_period: Comparison period used for movement values

    Returns:
        Merchant ranking response payload
    """
    merchants = await get_merchants(db, user, from_date, to_date, comparison_period)
    response = InsightsMerchantRankingResponse(merchants=merchants.ranking)
    return response
