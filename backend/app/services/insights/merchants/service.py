"""Shared merchant spending service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import (
    InsightsComparisonPeriod,
    InsightsMerchantDistributionResponse,
    InsightsMerchantRankingResponse,
    InsightsMerchantsResponse,
)
from app.services.dashboard import get_accessible_accounts
from app.services.insights.common import comparison_period_bounds
from app.services.insights.merchants.spend_stats_helpers import (
    MerchantSpendStats,
    MerchantSpendStatsById,
    get_merchant_spend_stats,
)

MERCHANT_DISTRIBUTION_LIMIT = 8
MERCHANT_RANKING_LIMIT = 10


MerchantDistributionRow = tuple[str, str, int, int | None, int | None]
MerchantRankingRow = tuple[str, str, int, int, int | None]


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

    current_stats, current_fx_status = await get_merchant_spend_stats(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    previous_stats, previous_fx_status = await get_merchant_spend_stats(
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
