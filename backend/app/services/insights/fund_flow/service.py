"""Fund-flow service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsFundFlowResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.fund_flow.entry_group_helpers import get_fund_flow_entry_groups
from app.services.insights.fund_flow.response_helpers import build_empty_fund_flow_response, build_fund_flow_response


async def get_fund_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsFundFlowResponse:
    """Return all converted entries for the Fund Flow card

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

    entry_groups = await get_fund_flow_entry_groups(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )

    response = build_fund_flow_response(entry_groups)
    return response
