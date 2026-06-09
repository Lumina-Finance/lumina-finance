"""Cash-flow service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsCashFlowResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.cash_flow.bucket_helpers import (
    get_cash_flow_bucket_rows,
    get_cash_flow_buckets,
)
from app.services.insights.cash_flow.daily_totals_helpers import get_cash_flow_daily_totals


async def get_cash_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsCashFlowResponse:
    """Return inflow and outflow buckets for the cash-flow card

    Args:
        db: Active database session
        user: User requesting the cash-flow insight
        from_date: Inclusive cash-flow range start date
        to_date: Inclusive cash-flow range end date

    Returns:
        Cash-flow response payload
    """
    # Load accounts the user can read before aggregating cash-flow totals
    accounts = await get_accessible_accounts(db, user)
    if not accounts:
        response = InsightsCashFlowResponse(points=[])
        return response

    buckets = get_cash_flow_buckets(from_date, to_date)
    daily_totals, fx_status = await get_cash_flow_daily_totals(db, accounts, user.base_currency, from_date, to_date)
    if not any(inflow > 0 or outflow > 0 for inflow, outflow in daily_totals.values()):
        response = InsightsCashFlowResponse(points=[], fx_status=fx_status)
        return response

    cash_flow_rows = get_cash_flow_bucket_rows(buckets, daily_totals)
    response = InsightsCashFlowResponse(points=cash_flow_rows, fx_status=fx_status)
    return response
