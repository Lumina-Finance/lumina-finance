"""Fund-flow service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsFundFlowResponse
from app.services.accounts.access import get_accessible_accounts
from app.services.insights.fund_flow.response_field_helpers import get_fund_flow_response_fields
from app.services.insights.fund_flow.response_helpers import build_empty_fund_flow_response, build_fund_flow_response


async def get_fund_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsFundFlowResponse:
    """Return the Fund Flow response for the selected date range

    Args:
        db: Active database session
        user: User requesting the fund-flow insight
        from_date: Inclusive fund-flow range start date
        to_date: Inclusive fund-flow range end date

    Returns:
        Fund-flow response payload
    """
    # Load accounts the user can read before aggregating fund-flow totals
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        response = build_empty_fund_flow_response()
        return response

    response_fields = await get_fund_flow_response_fields(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )

    response = build_fund_flow_response(response_fields)
    return response
