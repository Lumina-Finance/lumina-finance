"""Currency exponent lookup helpers"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.currency import Currency


async def get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Minor-unit exponents keyed by currency code
    """
    currency_codes = sorted(currencies)
    if not currency_codes:
        currency_exponents: dict[str, int] = {}
        return currency_exponents

    currency_query = select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currency_codes))

    # Load exponent metadata for every currency needed by FX conversion
    currency_result = await db.execute(currency_query)
    currency_exponents = {row.id: row.minor_unit_exponent for row in currency_result}
    return currency_exponents
