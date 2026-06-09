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
from app.services.insights.merchants.distribution_and_ranking_helpers import (
    get_merchant_distribution_rows,
    get_merchant_ranking_rows,
)
from app.services.insights.merchants.spend_stats_helpers import get_merchant_spend_stats


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
        distribution=get_merchant_distribution_rows(current_stats, previous_stats),
        ranking=get_merchant_ranking_rows(current_stats, previous_stats),
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
