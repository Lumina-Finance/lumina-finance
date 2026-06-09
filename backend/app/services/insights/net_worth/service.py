"""Net worth service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsNetWorthResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.net_worth.chart_series_helpers import get_net_worth_chart_series
from app.services.insights.net_worth.response import build_net_worth_response


async def get_net_worth(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsNetWorthResponse:
    """Return compact grouped net worth history for the insights card

    Args:
        db: Active database session
        user: User requesting the insight summary
        from_date: Inclusive chart start date
        to_date: Inclusive chart end date

    Returns:
        Net worth chart response payload
    """
    accounts = await get_accessible_accounts(db, user)
    if not accounts:
        response = InsightsNetWorthResponse(groups=[], points=[])
        return response

    baseline, chart_rows, fx_status = await get_net_worth_chart_series(db, accounts, user.base_currency, from_date, to_date)
    response = build_net_worth_response(
        baseline=baseline,
        chart_rows=chart_rows,
        fx_status=fx_status,
    )
    return response
