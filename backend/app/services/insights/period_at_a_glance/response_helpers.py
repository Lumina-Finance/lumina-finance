"""Response assembly helpers for the insights Period At A Glance card"""

from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsPeriodAtAGlanceResponse
from app.services.insights.period_at_a_glance.category_highlight_helpers import PeriodAtAGlanceCategoryHighlights


def build_period_at_a_glance_response(
    *,
    income: int,
    expenses: int,
    income_expense_fx_status: FxStatus,
    net_worth_change: int,
    net_worth_change_fx_status: FxStatus,
    category_highlights: PeriodAtAGlanceCategoryHighlights,
) -> InsightsPeriodAtAGlanceResponse:
    """Return the Period At A Glance API response from calculated values

    Args:
        income: Converted income total for the selected period
        expenses: Converted expense total for the selected period
        income_expense_fx_status: FX status from income and expense conversion
        net_worth_change: Converted net-worth movement for the selected period
        net_worth_change_fx_status: FX status from net-worth conversion
        category_highlights: Category highlight values and their FX statuses

    Returns:
        Period At A Glance response payload
    """
    top_category_name = None
    top_category_share_pct = None
    if category_highlights.top_category is not None:
        top_category_name, top_category_share_pct = category_highlights.top_category

    biggest_change_name = None
    biggest_change_amount = None
    biggest_change_pct = None
    if category_highlights.biggest_change is not None:
        biggest_change_name, biggest_change_amount, biggest_change_pct = category_highlights.biggest_change

    return InsightsPeriodAtAGlanceResponse(
        income=income,
        expenses=expenses,
        income_expense_fx_status=income_expense_fx_status,
        net_worth_change=net_worth_change,
        net_worth_change_fx_status=net_worth_change_fx_status,
        top_category_name=top_category_name,
        top_category_share_pct=top_category_share_pct,
        top_category_fx_status=category_highlights.top_category_fx_status,
        biggest_change_name=biggest_change_name,
        biggest_change_amount=biggest_change_amount,
        biggest_change_pct=biggest_change_pct,
        biggest_change_fx_status=category_highlights.biggest_change_fx_status,
    )
