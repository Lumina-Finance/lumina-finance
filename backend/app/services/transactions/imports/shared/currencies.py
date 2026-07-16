"""Transaction import currency loading"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.currency import Currency


async def get_import_currencies_by_code(db: AsyncSession, currency_codes: set[str]) -> dict[str, Currency]:
    """Return currency rows keyed by currency code for imported accounts

    Args:
        db: Active database session
        currency_codes: Currency codes used by accounts in the import

    Returns:
        Currency rows keyed by currency code

    Raises:
        HTTPException: Raised with 422 when any currency code is missing
    """
    # Load all account currencies used by the import so row amounts can be parsed with the right precision
    result = await db.execute(select(Currency).where(Currency.id.in_(currency_codes)))
    currencies_by_code = {currency.id: currency for currency in result.scalars().all()}
    missing_currency_codes = currency_codes - currencies_by_code.keys()
    if missing_currency_codes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Invalid currency code: {sorted(missing_currency_codes)[0]}",
        )
    return currencies_by_code
