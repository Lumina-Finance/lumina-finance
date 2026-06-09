"""Response assembly helpers for fund-flow insights"""

from app.schemas.insights import InsightsFundFlowResponse
from app.services.insights.fund_flow.response_field_helpers import FundFlowResponseFields


def build_empty_fund_flow_response() -> InsightsFundFlowResponse:
    """Return an empty fund-flow response

    Returns:
        Fund-flow response payload with empty response fields
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


def build_fund_flow_response(response_fields: FundFlowResponseFields) -> InsightsFundFlowResponse:
    """Return fund-flow response from converted response field values

    Args:
        response_fields: Converted values for the Fund Flow response fields

    Returns:
        Fund-flow response payload
    """
    response = InsightsFundFlowResponse(
        income_sources=response_fields.income_sources,
        expense_categories=response_fields.expense_categories,
        income_outflows=response_fields.income_outflows,
        expense_inflows=response_fields.expense_inflows,
        income_source_count=len(response_fields.income_sources),
        expense_category_count=len(response_fields.expense_categories),
        fx_status=response_fields.fx_status,
    )
    return response
