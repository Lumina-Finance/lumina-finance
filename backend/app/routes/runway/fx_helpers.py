"""Runway FX route helpers"""
import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.schemas.user import RunwayAccountBalance
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents
from app.services.snapshots import get_current_balances


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
