"""Response assembly helpers for merchant insights"""

from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsMerchantsResponse
from app.services.insights.fx_status_helpers import get_combined_fx_status
from app.services.insights.merchants.distribution_and_ranking_helpers import (
    get_merchant_distribution_rows,
    get_merchant_ranking_rows,
)
from app.services.insights.merchants.spend_stats_helpers import MerchantSpendStatsById


def build_merchants_response(
    *,
    current_stats: MerchantSpendStatsById,
    previous_stats: MerchantSpendStatsById,
    current_fx_status: FxStatus,
    previous_fx_status: FxStatus,
) -> InsightsMerchantsResponse:
    """Return merchant insights response from selected and comparison stats

    Args:
        current_stats: Selected-period merchant spend stats keyed by merchant ID
        previous_stats: Comparison-period merchant spend stats keyed by merchant ID
        current_fx_status: FX status from the selected period
        previous_fx_status: FX status from the comparison period

    Returns:
        Merchant insight response payload
    """
    distribution_rows = get_merchant_distribution_rows(current_stats, previous_stats)
    ranking_rows = get_merchant_ranking_rows(current_stats, previous_stats)
    fx_status = get_combined_fx_status(current_fx_status, previous_fx_status)

    response = InsightsMerchantsResponse(
        distribution=distribution_rows,
        ranking=ranking_rows,
        fx_status=fx_status,
    )
    return response
