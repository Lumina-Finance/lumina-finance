"""Response assembly helpers for fund-flow insights"""

from app.schemas.insights import InsightsFundFlowResponse
from app.services.insights.fund_flow.entry_group_helpers import FundFlowEntryGroups


def build_empty_fund_flow_response() -> InsightsFundFlowResponse:
    """Return an empty fund-flow response

    Returns:
        Fund-flow response payload with no entries
    """
    response = InsightsFundFlowResponse(
        income_sources=[],
        expense_categories=[],
        income_outflows=[],
        expense_inflows=[],
        income_source_count=0,
        expense_category_count=0,
    )
    return response


def build_fund_flow_response(entry_groups: FundFlowEntryGroups) -> InsightsFundFlowResponse:
    """Return fund-flow response from grouped entries

    Args:
        entry_groups: Fund-flow entries grouped by response role

    Returns:
        Fund-flow response payload
    """
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
