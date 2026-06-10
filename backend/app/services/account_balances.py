"""Account balance conversion service"""
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.fx import FxRateIssue, FxStatus
from app.services.fx import FxConverter, FxRateKey
from app.services.fx.currency_exponent_helpers import get_currency_exponents


async def attach_base_currency_current_balances(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    rate_date: date,
) -> None:
    """Attach current balances converted to the user's base currency

    Args:
        db: Active database session
        accounts: Accounts receiving derived balance fields
        base_currency: User base currency used for account totals
        rate_date: Date used for FX conversion
    """
    if not accounts:
        return

    converter = FxConverter(
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )

    for account in accounts:
        current_balance = getattr(account, "current_balance", 0)
        normalized_base = account.currency.upper()
        normalized_quote = base_currency.upper()
        converted_balance = await converter.convert_minor_units(
            current_balance,
            base=account.currency,
            quote=base_currency,
            rate_date=rate_date,
        )
        account.base_currency_current_balance = converted_balance if converted_balance is not None else 0
        account.current_balance_fx_status = _get_current_balance_fx_status(
            converter,
            rate_date=rate_date,
            base=normalized_base,
            quote=normalized_quote,
            converted=converted_balance,
            amount=current_balance,
        )


def _get_current_balance_fx_status(
    converter: FxConverter,
    *,
    rate_date: date,
    base: str,
    quote: str,
    converted: int | None,
    amount: int,
) -> FxStatus:
    """Return FX status for one converted account balance

    Args:
        converter: Request-scoped FX converter
        rate_date: Date used for FX conversion
        base: Source currency code
        quote: Target currency code
        converted: Converted balance, or None when conversion failed
        amount: Source balance amount in minor units

    Returns:
        FX status for the balance conversion
    """
    if base == quote or amount == 0:
        return FxStatus()
    if converted is not None:
        return FxStatus(state="complete")

    key = FxRateKey(rate_date, base, quote)
    reason = converter.failed_rates.get(key)
    state = "unavailable" if reason == "provider_unavailable" else "incomplete"
    return FxStatus(
        state=state,
        missing_pairs=[FxRateIssue(base=base, quote=quote)],
    )
