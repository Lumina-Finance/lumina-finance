"""Net worth balance conversion helpers for dashboard widgets"""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.currency import Currency
from app.services.fx import FxConverter


async def get_dashboard_net_worth_fx_converter(
    db: AsyncSession,
    currencies: set[str],
) -> FxConverter:
    """Return an FX converter configured for dashboard net worth balances

    Args:
        db: Active database session
        currencies: Currency codes needed for conversion

    Returns:
        FX converter with minor-unit exponents loaded
    """
    currency_exponents = await _get_currency_exponents(db, currencies)
    converter = FxConverter(currency_exponents=currency_exponents)
    return converter


async def prefetch_dashboard_net_worth_fx_rates(
    converter: FxConverter,
    accounts: list[Account],
    *,
    base_currency: str,
    start_date: date,
    end_date: date,
) -> None:
    """Prefetch FX rates needed by dashboard net worth balances

    Args:
        converter: Request-scoped FX converter
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        start_date: Inclusive rate start date
        end_date: Inclusive rate end date
    """
    foreign_currencies = {account.currency for account in accounts if account.currency != base_currency}
    for currency in sorted(foreign_currencies):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


async def get_converted_net_worth_balance_total(
    accounts_by_id: dict[uuid.UUID, Account],
    running_balances: dict[uuid.UUID, int],
    *,
    base_currency: str,
    rate_date: date,
    converter: FxConverter,
) -> int:
    """Return account balances converted and summed in the user's base currency

    Args:
        accounts_by_id: Account rows keyed by account ID
        running_balances: Account balances keyed by account ID
        base_currency: User base currency used for dashboard totals
        rate_date: Date used for FX conversion
        converter: Request-scoped FX converter

    Returns:
        Sum of balances that converted successfully
    """
    total = 0

    # Convert each running account balance before adding it to the base-currency total
    for account_id, account in accounts_by_id.items():
        converted_balance = await converter.convert_minor_units(
            running_balances[account_id],
            base=account.currency,
            quote=base_currency,
            rate_date=rate_date,
        )
        if converted_balance is not None:
            total += converted_balance
    return total


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Net-worth conversion uses this metadata to interpret snapshot balances
    before converting them to the user's base currency

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    currency_codes = sorted(currencies)

    # Load exponent metadata for every currency needed by dashboard net worth conversions
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currency_codes)),
    )
    currency_exponents = {row.id: row.minor_unit_exponent for row in currency_result}
    return currency_exponents
