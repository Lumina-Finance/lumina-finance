"""User runway response route helpers"""
import calendar
import uuid
from datetime import date, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.routes.user_runway_account_helpers import (
    get_active_runway_account_ids,
    get_readable_non_archived_accounts_for_runway,
    get_runway_thresholds_from_user,
)
from app.schemas.fx import FxStatus
from app.schemas.user import RunwayAccountBalance, RunwayResponse, RunwayThresholds
from app.services.fx import FxConverter
from app.services.snapshots import get_current_balances

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


async def get_runway_fx_converter(
    db: AsyncSession,
    user: User,
    account_by_id: dict[uuid.UUID, Account],
    selected_accounts: list[Account],
    expense_rows: list[Any],
) -> FxConverter:
    """Return an FX converter configured for runway currencies

    Args:
        db: Active database session
        user: Authenticated user
        account_by_id: Readable accounts keyed by identifier
        selected_accounts: Accounts selected for liquid balance
        expense_rows: Grouped expense rows inside the runway history window

    Returns:
        FX converter with currency exponents loaded
    """
    expense_currencies = {account_by_id[row.account_id].currency for row in expense_rows}
    selected_currencies = {account.currency for account in selected_accounts}
    currency_exponents = await get_currency_exponents(db, {user.base_currency, *expense_currencies, *selected_currencies})
    converter = FxConverter(currency_exponents=currency_exponents)
    return converter


async def get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to fetch

    Returns:
        Minor-unit exponent keyed by currency code
    """
    requested_currencies = currencies

    # Fetch currency exponents so balance and transaction amounts can be converted correctly
    currency_result = await db.execute(select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(requested_currencies)))
    currency_exponents = {row.id: row.minor_unit_exponent for row in currency_result}
    return currency_exponents


async def prefetch_runway_fx_rates(
    converter: FxConverter,
    user: User,
    account_by_id: dict[uuid.UUID, Account],
    selected_accounts: list[Account],
    expense_rows: list[Any],
    window_start: date,
    window_end: date,
    today: date,
) -> None:
    """Prefetch FX rates needed for runway calculations

    Args:
        converter: FX converter used for runway calculations
        user: Authenticated user
        account_by_id: Readable accounts keyed by identifier
        selected_accounts: Accounts selected for liquid balance
        expense_rows: Grouped expense rows inside the runway history window
        window_start: Inclusive start date for completed-month history
        window_end: Exclusive end date for completed-month history
        today: Current date in the user's timezone
    """
    expense_currencies = {account_by_id[row.account_id].currency for row in expense_rows}
    selected_currencies = {account.currency for account in selected_accounts}
    non_base_currencies = sorted((expense_currencies | selected_currencies) - {user.base_currency})

    # Prefetch one FX range per non-base currency covering historical expenses and current selected balances
    for currency in non_base_currencies:
        await converter.prefetch_rates(
            base=currency,
            quote=user.base_currency,
            start_date=window_start if currency in expense_currencies else today,
            end_date=today if currency in selected_currencies else window_end - timedelta(days=1),
        )


async def get_converted_runway_account_balances(
    db: AsyncSession,
    selected_accounts: list[Account],
    selected_account_ids: list[uuid.UUID],
    converter: FxConverter,
    user: User,
    today: date,
) -> tuple[list[RunwayAccountBalance], int]:
    """Return selected account balances converted to the user's base currency

    Args:
        db: Active database session
        selected_accounts: Accounts selected for liquid balance
        selected_account_ids: Selected account identifiers
        converter: FX converter used for runway calculations
        user: Authenticated user
        today: Current date in the user's timezone

    Returns:
        Converted account balance rows and total liquid balance
    """
    balances = await get_current_balances(db, selected_account_ids)
    account_balances: list[RunwayAccountBalance] = []
    liquid_balance = 0

    # Convert each selected account balance to the user's base currency for the current day
    for account in selected_accounts:
        converted_balance = await converter.convert_minor_units(
            balances.get(account.id, 0),
            base=account.currency,
            quote=user.base_currency,
            rate_date=today,
        )
        if converted_balance is None:
            continue

        liquid_balance += converted_balance
        balance_row = RunwayAccountBalance(account_id=account.id, balance=converted_balance)
        account_balances.append(balance_row)

    result = (account_balances, liquid_balance)
    return result


async def get_runway_category_month_totals(
    converter: FxConverter,
    account_by_id: dict[uuid.UUID, Account],
    expense_rows: list[Any],
    user: User,
) -> dict[tuple[date, uuid.UUID], int]:
    """Return converted runway expense totals grouped by month and category

    Args:
        converter: FX converter used for runway calculations
        account_by_id: Readable accounts keyed by identifier
        expense_rows: Grouped expense rows inside the runway history window
        user: Authenticated user

    Returns:
        Converted expense totals keyed by month and category
    """
    category_month_totals: dict[tuple[date, uuid.UUID], int] = {}

    # Convert account-currency expense totals into the user's base currency by transaction date
    for row in expense_rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=account_by_id[row.account_id].currency,
            quote=user.base_currency,
            rate_date=row.dt,
        )
        if converted_total is None:
            continue

        month_category_key = (date(row.dt.year, row.dt.month, 1), row.category_id)
        category_month_totals[month_category_key] = category_month_totals.get(month_category_key, 0) + converted_total

    return category_month_totals


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
