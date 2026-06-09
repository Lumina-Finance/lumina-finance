"""Fund-flow service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsFundFlowResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.fund_flow.entry_group_helpers import get_fund_flow_entry_groups


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
        response = InsightsFundFlowResponse(
            income_sources=[],
            expense_categories=[],
            income_outflows=[],
            expense_inflows=[],
            income_source_count=0,
            expense_category_count=0,
        )
        return response

    entry_groups = await get_fund_flow_entry_groups(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )

    response = InsightsFundFlowResponse(
        income_sources=entry_groups.income_sources,
        expense_categories=entry_groups.expense_categories,
        income_outflows=entry_groups.income_outflows,
        expense_inflows=entry_groups.expense_inflows,
        income_source_count=len(entry_groups.income_sources),
        expense_category_count=len(entry_groups.expense_categories),
        fx_status=entry_groups.fx_status,
    )
    return response
