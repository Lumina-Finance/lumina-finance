"""User runway response route helpers"""
import calendar
import uuid
from datetime import date
from typing import Any

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.routes.user_runway_account_helpers import (
    get_active_runway_account_ids,
    get_readable_non_archived_accounts_for_runway,
    get_runway_thresholds_from_user,
)
from app.routes.user_runway_fx_helpers import (
    get_converted_runway_account_balances,
    get_runway_category_month_totals,
    get_runway_fx_converter,
    prefetch_runway_fx_rates,
)
from app.schemas.fx import FxStatus
from app.schemas.user import RunwayAccountBalance, RunwayResponse, RunwayThresholds

# Trailing window used to smooth seasonal spikes while staying current with lifestyle changes
_RUNWAY_WINDOW_MONTHS = 12


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
    readable_accounts = await get_readable_non_archived_accounts_for_runway(db, user)
    account_by_id = {account.id: account for account in readable_accounts}
    readable_account_ids = set(account_by_id)
    active_runway_account_ids = await get_active_runway_account_ids(db, user)
    selected_account_ids = [account_id for account_id in active_runway_account_ids if account_id in readable_account_ids]
    selected_accounts = [account_by_id[account_id] for account_id in selected_account_ids]
    thresholds = get_runway_thresholds_from_user(user)

    if not selected_account_ids:
        response = build_no_accounts_runway_response(thresholds)
        return response

    window_end = date(today.year, today.month, 1)
    window_start = get_month_shifted_date(window_end, -_RUNWAY_WINDOW_MONTHS)
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

    response = build_runway_response(
        expense_outflow,
        months_covered,
        liquid_balance,
        account_balances,
        thresholds,
        fx_status,
    )
    return response


def get_month_shifted_date(start: date, months: int) -> date:
    """Return a date shifted by whole calendar months

    Args:
        start: Starting date
        months: Number of months to shift

    Returns:
        Shifted date anchored to the closest valid day in the target month
    """
    month_index = (start.year * 12 + start.month - 1) + months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    shifted_date = date(year, month, day)
    return shifted_date


async def get_runway_expense_rows(
    db: AsyncSession,
    readable_account_ids: set[uuid.UUID],
    window_start: date,
    window_end: date,
) -> list[Any]:
    """Return grouped expense rows inside the runway history window

    Args:
        db: Active database session
        readable_account_ids: Account IDs readable by the user
        window_start: Inclusive start date for completed-month history
        window_end: Exclusive end date for completed-month history

    Returns:
        Expense total rows grouped by date, account, and category
    """
    account_ids = readable_account_ids

    # Fetch expense totals by transaction date, account, and category inside the completed-month runway window
    expense_result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id.label("category_id"),
            sa.func.sum(Transaction.amount).label("total"),
        )
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(Transaction.account_id.in_(account_ids))
        .where(Transaction.dt >= window_start)
        .where(Transaction.dt < window_end)
        .where(Category.kind == CategoryKind.EXPENSE)
        .group_by(Transaction.dt, Transaction.account_id, Category.id)
    )
    expense_rows = list(expense_result)
    return expense_rows


def get_runway_expense_outflow_summary(
    category_month_totals: dict[tuple[date, uuid.UUID], int],
) -> tuple[int, int]:
    """Return covered month count and expense outflow for runway history

    Args:
        category_month_totals: Converted expense totals keyed by month and category

    Returns:
        Covered month count and net expense outflow
    """
    outflow_totals = [
        (month, total)
        for (month, _category_id), total in category_month_totals.items()
        if total < 0
    ]
    months_covered = len({month for month, _total in outflow_totals})

    # Negative expense category-month totals count toward runway while refunds reduce expenses
    expense_outflow = sum(total for _month, total in outflow_totals)
    summary = (months_covered, expense_outflow)
    return summary


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


def build_runway_response(
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
