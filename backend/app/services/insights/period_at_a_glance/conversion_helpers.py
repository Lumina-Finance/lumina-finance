"""FX conversion helpers for the insights Period At A Glance card"""

from collections.abc import Iterable
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.currency import Currency
from app.services.fx import FxConverter


async def get_period_at_a_glance_currency_exponents(
    db: AsyncSession,
    currencies: set[str],
) -> dict[str, int]:
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
    return {row.id: row.minor_unit_exponent for row in result}


async def prefetch_period_at_a_glance_rates(
    converter: FxConverter,
    *,
    rows: Iterable[Any],
    base_currency: str,
) -> None:
    """Prefetch FX rates needed for period total conversion

    Args:
        converter: FX converter used by the Period At A Glance calculation
        rows: Grouped transaction rows containing account currency and transaction date
        base_currency: User base currency used for converted values

    Returns:
        None
    """
    ranges: dict[str, tuple[date, date]] = {}

    # Build one date range per currency so rate prefetching stays compact
    for row in rows:
        currency = row.account_currency
        if currency == base_currency:
            continue
        start, end = ranges.get(currency, (row.date, row.date))
        ranges[currency] = (min(start, row.date), max(end, row.date))

    for currency, (start_date, end_date) in sorted(ranges.items()):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )
