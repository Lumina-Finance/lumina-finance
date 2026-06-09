"""Response assembly helpers for cash-flow insights"""

from datetime import date

from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsCashFlowResponse
from app.services.insights.cash_flow.bucket_helpers import (
    get_cash_flow_bucket_rows,
    get_cash_flow_buckets,
)
from app.services.insights.cash_flow.daily_totals_helpers import DailyCashFlowTotalsByDate


def build_cash_flow_response(
    *,
    from_date: date,
    to_date: date,
    daily_totals: DailyCashFlowTotalsByDate,
    fx_status: FxStatus,
) -> InsightsCashFlowResponse:
    """Return cash-flow response from daily totals

    Args:
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date
        daily_totals: Daily inflow and outflow totals keyed by date
        fx_status: FX conversion status from daily total loading

    Returns:
        Cash-flow response payload
    """
    has_cash_flow_activity = any(inflow > 0 or outflow > 0 for inflow, outflow in daily_totals.values())
    if not has_cash_flow_activity:
        response = InsightsCashFlowResponse(points=[], fx_status=fx_status)
        return response

    buckets = get_cash_flow_buckets(from_date, to_date)
    cash_flow_rows = get_cash_flow_bucket_rows(buckets, daily_totals)
    response = InsightsCashFlowResponse(points=cash_flow_rows, fx_status=fx_status)
    return response
