"""Balance conversion helpers for insights net worth"""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.currency import Currency
from app.services.fx import FxConverter
from app.services.insights.net_worth.groups import NET_WORTH_GROUPS


async def build_net_worth_fx_converter(
    db: AsyncSession,
    currencies: set[str],
) -> FxConverter:
    """Return an FX converter configured for net-worth balance conversion

    Args:
        db: Active database session
        currencies: Currency codes needed for conversion

    Returns:
        FX converter with minor-unit exponents loaded
    """
    currency_exponents = await _get_currency_exponents(db, currencies)
    converter = FxConverter(currency_exponents=currency_exponents)
    return converter


async def prefetch_net_worth_fx_rates(
    converter: FxConverter,
    *,
    accounts: list[Account],
    buckets: list[tuple[date, date]],
    base_currency: str,
    baseline_date: date,
) -> None:
    """Prefetch FX rates needed for net worth chart conversion

    Args:
        converter: FX converter used by the net worth chart calculation
        accounts: Accounts included in the chart
        buckets: Chart buckets whose value dates may require conversion
        base_currency: User base currency used for converted values
        baseline_date: Date immediately before the selected range

    Returns:
        None
    """
    if not buckets:
        return

    start_date = min(baseline_date, *(value_date for _label_date, value_date in buckets))
    end_date = max(value_date for _label_date, value_date in buckets)

    # Prefetch one date range per foreign account currency used by the chart
    for currency in sorted({account.currency for account in accounts if account.currency != base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


async def get_grouped_net_worth_balance_values(
    accounts: list[Account],
    group_index_by_account_id: dict[uuid.UUID, int],
    balances: dict[uuid.UUID, int],
    *,
    base_currency: str,
    rate_date: date,
    converter: FxConverter,
) -> list[int]:
    """Return grouped converted balance values for one chart date

    Args:
        accounts: Accounts included in the chart
        group_index_by_account_id: Net worth group indexes keyed by account ID
        balances: Balance amounts keyed by account ID
        base_currency: User base currency used for converted values
        rate_date: Date used for FX conversion
        converter: FX converter used for balance conversion

    Returns:
        Converted grouped values in net worth group order
    """
    values = [0] * len(NET_WORTH_GROUPS)

    # Convert each account balance and add it to the account's configured net worth group
    for account in accounts:
        converted_balance = await converter.convert_minor_units(
            int(balances.get(account.id, 0)),
            base=account.currency,
            quote=base_currency,
            rate_date=rate_date,
        )
        if converted_balance is None:
            continue

        group_index = group_index_by_account_id[account.id]
        values[group_index] += converted_balance
    return values


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents keyed by currency code

    Args:
        db: Active database session
        currencies: Currency codes needed for conversion

    Returns:
        Minor-unit exponent keyed by currency code
    """
    # Load currency precision so FX conversion can convert minor units correctly
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    exponents_by_currency = {row.id: row.minor_unit_exponent for row in result}
    return exponents_by_currency
