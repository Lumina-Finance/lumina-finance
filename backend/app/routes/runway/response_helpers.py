"""Runway response route helpers"""
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.routes.runway.account_helpers import (
    get_active_runway_account_ids,
    get_readable_accounts_for_runway,
    get_runway_thresholds_from_user,
)
from app.routes.runway.expense_helpers import (
    get_runway_expense_outflow_summary,
    get_runway_expense_rows,
    get_runway_history_window,
)
from app.routes.runway.fx_helpers import (
    get_converted_runway_account_balances,
    get_runway_category_month_totals,
    get_runway_fx_converter,
    prefetch_runway_fx_rates,
)
from app.routes.runway.response_build_helpers import (
    build_calculated_runway_response,
    build_insufficient_history_runway_response,
    build_no_accounts_runway_response,
)
from app.schemas.user import RunwayResponse


async def get_runway_response(
    db: AsyncSession,
    user: User,
    today: date,
) -> RunwayResponse:
    """Return the user's runway response

    Args:
        db: Active database session
        user: Authenticated user
        today: Current date in the user's timezone

    Returns:
        Cash runway response for the user
    """
    readable_accounts = await get_readable_accounts_for_runway(db, user)
    account_by_id = {account.id: account for account in readable_accounts}
    readable_account_ids = set(account_by_id)
    active_runway_account_ids = await get_active_runway_account_ids(db, user)
    selected_account_ids = [account_id for account_id in active_runway_account_ids if account_id in readable_account_ids]
    selected_accounts = [account_by_id[account_id] for account_id in selected_account_ids]
    thresholds = get_runway_thresholds_from_user(user)

    if not selected_account_ids:
        response = build_no_accounts_runway_response(thresholds)
        return response

    window_start, window_end = get_runway_history_window(today)
    expense_rows = await get_runway_expense_rows(db, readable_account_ids, window_start, window_end)
    converter = await get_runway_fx_converter(db, user, account_by_id, selected_accounts, expense_rows)
    await prefetch_runway_fx_rates(
        converter,
        user,
        account_by_id,
        selected_accounts,
        expense_rows,
        window_start,
        window_end,
        today,
    )
    account_balances, liquid_balance = await get_converted_runway_account_balances(
        db,
        selected_accounts,
        selected_account_ids,
        converter,
        user,
        today,
    )
    category_month_totals = await get_runway_category_month_totals(converter, account_by_id, expense_rows, user)
    months_covered, expense_outflow = get_runway_expense_outflow_summary(category_month_totals)
    fx_status = converter.get_status()

    if months_covered < 1 or expense_outflow >= 0:
        response = build_insufficient_history_runway_response(
            months_covered,
            liquid_balance,
            account_balances,
            thresholds,
            fx_status,
        )
        return response

    response = build_calculated_runway_response(
        expense_outflow,
        months_covered,
        liquid_balance,
        account_balances,
        thresholds,
        fx_status,
    )
    return response
