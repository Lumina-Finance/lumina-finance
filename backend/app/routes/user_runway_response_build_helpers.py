"""User runway response build helpers"""

from app.schemas.fx import FxStatus
from app.schemas.user import RunwayAccountBalance, RunwayResponse, RunwayThresholds


def build_no_accounts_runway_response(thresholds: RunwayThresholds) -> RunwayResponse:
    """Build a runway response for users with no selected accounts

    Args:
        thresholds: Runway status thresholds

    Returns:
        Runway response explaining that no accounts are selected
    """
    response = RunwayResponse(
        months=None,
        reason="no_accounts",
        avg_monthly_expense=0,
        months_covered=0,
        liquid_balance=0,
        account_balances=[],
        thresholds=thresholds,
        fx_status=FxStatus(),
    )
    return response


def build_insufficient_history_runway_response(
    months_covered: int,
    liquid_balance: int,
    account_balances: list[RunwayAccountBalance],
    thresholds: RunwayThresholds,
    fx_status: FxStatus,
) -> RunwayResponse:
    """Build a runway response when expense history is insufficient

    Args:
        months_covered: Number of months with negative expense outflow
        liquid_balance: Converted selected account balance total
        account_balances: Converted selected account balances
        thresholds: Runway status thresholds
        fx_status: FX conversion status

    Returns:
        Runway response explaining that history is insufficient
    """
    response = RunwayResponse(
        months=None,
        reason="insufficient_history",
        avg_monthly_expense=0,
        months_covered=months_covered,
        liquid_balance=liquid_balance,
        account_balances=account_balances,
        thresholds=thresholds,
        fx_status=fx_status,
    )
    return response


def build_calculated_runway_response(
    expense_outflow: int,
    months_covered: int,
    liquid_balance: int,
    account_balances: list[RunwayAccountBalance],
    thresholds: RunwayThresholds,
    fx_status: FxStatus,
) -> RunwayResponse:
    """Build a runway response from liquid balance and expense history

    Args:
        expense_outflow: Net negative expense total across covered months
        months_covered: Number of months with negative expense outflow
        liquid_balance: Converted selected account balance total
        account_balances: Converted selected account balances
        thresholds: Runway status thresholds
        fx_status: FX conversion status

    Returns:
        Runway response with calculated months
    """
    avg_monthly_expense = abs(expense_outflow) // months_covered
    months = liquid_balance / avg_monthly_expense if avg_monthly_expense > 0 else None
    response = RunwayResponse(
        months=max(0.0, months) if months is not None else None,
        reason=None,
        avg_monthly_expense=avg_monthly_expense,
        months_covered=months_covered,
        liquid_balance=liquid_balance,
        account_balances=account_balances,
        thresholds=thresholds,
        fx_status=fx_status,
    )
    return response
