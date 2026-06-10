"""Response assembly helpers for savings-rate trend insights"""

from datetime import date

from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsSavingsRateTrendResponse
from app.services.savings_rate.monthly_category_total_helpers import SavingsRateMonthlyCategoryTotalsByKey

MonthlySavingsRateTotals = dict[date, dict[str, int]]


def build_empty_savings_rate_trend_response() -> InsightsSavingsRateTrendResponse:
    """Return an empty savings-rate trend response

    Returns:
        Savings-rate trend response payload with no points
    """
    response = InsightsSavingsRateTrendResponse(points=[])
    return response


def build_savings_rate_trend_response(
    months: list[date],
    monthly_category_totals: SavingsRateMonthlyCategoryTotalsByKey,
    fx_status: FxStatus,
) -> InsightsSavingsRateTrendResponse:
    """Return savings-rate trend response from monthly category totals

    Args:
        months: Month starts included in the response
        monthly_category_totals: Converted monthly category totals keyed by month and category
        fx_status: FX conversion status from monthly total loading

    Returns:
        Savings-rate trend response payload
    """
    totals = _get_monthly_savings_rate_totals(months, monthly_category_totals)
    points = [
        (
            month,
            totals[month]["income"],
            totals[month]["expenses"],
        )
        for month in months
    ]
    response = InsightsSavingsRateTrendResponse(points=points, fx_status=fx_status)
    return response


def _get_monthly_savings_rate_totals(
    months: list[date],
    monthly_category_totals: SavingsRateMonthlyCategoryTotalsByKey,
) -> MonthlySavingsRateTotals:
    """Return monthly income and expense totals from signed category totals

    Args:
        months: Month starts included in the response
        monthly_category_totals: Converted monthly category totals keyed by month and category

    Returns:
        Income and expense totals keyed by month
    """
    totals = {month: {"income": 0, "expenses": 0} for month in months}

    # Classify signed category totals into monthly income and expense totals
    for (month, _category_id), total in monthly_category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    return totals
