"""Shared merchant spending service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import (
    InsightsComparisonPeriod,
    InsightsMerchantDistributionResponse,
    InsightsMerchantRankingResponse,
    InsightsMerchantsResponse,
)
from app.services.dashboard import get_accessible_accounts
from app.services.insights.common import comparison_period_bounds
from app.services.insights.merchants.response_helpers import build_merchants_response
from app.services.insights.merchants.spend_stats_helpers import get_merchant_spend_stats


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

    # Load accounts the user can read before aggregating merchant spend
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        response = InsightsMerchantsResponse(distribution=[], ranking=[])
        return response

    # Query selected-period merchant spend for readable accounts
    current_stats, current_fx_status = await get_merchant_spend_stats(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )

    # Query comparison-period merchant spend for movement values
    previous_stats, previous_fx_status = await get_merchant_spend_stats(
        db,
        accounts,
        user.base_currency,
        previous_from_date,
        previous_to_date,
    )

    response = build_merchants_response(
        current_stats=current_stats,
        previous_stats=previous_stats,
        current_fx_status=current_fx_status,
        previous_fx_status=previous_fx_status,
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
