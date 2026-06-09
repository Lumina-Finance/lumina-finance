"""Response assembly helpers for the income/expense breakdown card"""

from app.models.base import CategoryKind
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsIncomeExpenseBreakdownResponse
from app.services.insights.income_expense_breakdown.breakdown_rows import (
    BreakdownCategoryStatsById,
    get_income_expense_breakdown_rows,
    get_income_expense_breakdown_total,
)
from app.services.insights.income_expense_breakdown.trend_rows import CategoryTrendRow


def build_income_expense_breakdown_response(
    *,
    current_expense_breakdown: BreakdownCategoryStatsById,
    current_income_breakdown: BreakdownCategoryStatsById,
    expense_increases: list[CategoryTrendRow],
    expense_decreases: list[CategoryTrendRow],
    income_increases: list[CategoryTrendRow],
    income_decreases: list[CategoryTrendRow],
    current_fx_status: FxStatus,
    previous_fx_status: FxStatus,
) -> InsightsIncomeExpenseBreakdownResponse:
    """Return the income/expense breakdown API response from calculated values

    Args:
        current_expense_breakdown: Expense-side breakdown stats keyed by category ID
        current_income_breakdown: Income-side breakdown stats keyed by category ID
        expense_increases: Expense category increase rows
        expense_decreases: Expense category decrease rows
        income_increases: Income category increase rows
        income_decreases: Income category decrease rows
        current_fx_status: FX status from the selected period
        previous_fx_status: FX status from the comparison period

    Returns:
        Income and expense breakdown response payload
    """
    # Subtract refunds and losses from centre totals while keeping their rows visible
    expense_refunds = _get_expense_refunds(current_income_breakdown)
    income_losses = _get_income_losses(current_expense_breakdown)

    return InsightsIncomeExpenseBreakdownResponse(
        expense=get_income_expense_breakdown_rows(current_expense_breakdown),
        income=get_income_expense_breakdown_rows(current_income_breakdown),
        expense_total=max(get_income_expense_breakdown_total(current_expense_breakdown) - expense_refunds, 0),
        income_total=max(get_income_expense_breakdown_total(current_income_breakdown) - income_losses, 0),
        expense_increases=expense_increases,
        expense_decreases=expense_decreases,
        income_increases=income_increases,
        income_decreases=income_decreases,
        fx_status=_combine_fx_statuses(current_fx_status, previous_fx_status),
    )


def _get_expense_refunds(current_income_breakdown: BreakdownCategoryStatsById) -> int:
    """Return expense-category amounts that landed on the income side

    Args:
        current_income_breakdown: Income-side breakdown stats keyed by category ID

    Returns:
        Expense refund amount to subtract from expense totals
    """
    return sum(
        stats.amount
        for stats in current_income_breakdown.values()
        if stats.category_kind == CategoryKind.EXPENSE
    )


def _get_income_losses(current_expense_breakdown: BreakdownCategoryStatsById) -> int:
    """Return income-category amounts that landed on the expense side

    Args:
        current_expense_breakdown: Expense-side breakdown stats keyed by category ID

    Returns:
        Income loss amount to subtract from income totals
    """
    return sum(
        stats.amount
        for stats in current_expense_breakdown.values()
        if stats.category_kind == CategoryKind.INCOME
    )


def _combine_fx_statuses(current_status: FxStatus, previous_status: FxStatus) -> FxStatus:
    """Return one FX status for current and comparison period calculations

    Args:
        current_status: FX status from the selected period
        previous_status: FX status from the comparison period

    Returns:
        Combined FX status with duplicate missing pairs removed
    """
    if current_status.state == "none":
        return previous_status
    if previous_status.state == "none":
        return current_status

    missing_pairs = []
    seen_pairs = set()
    for status in (current_status, previous_status):
        for pair in status.missing_pairs:
            key = (pair.base, pair.quote)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            missing_pairs.append(pair)

    if not missing_pairs:
        return FxStatus(state="complete")

    state = "unavailable" if current_status.state == previous_status.state == "unavailable" else "incomplete"
    return FxStatus(state=state, missing_pairs=missing_pairs)
