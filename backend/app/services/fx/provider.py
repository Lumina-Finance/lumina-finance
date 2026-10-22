"""The interface an exchange rate provider offers the converter"""

from datetime import date
from decimal import Decimal
from typing import Protocol


class FxRateProvider(Protocol):
    """Provider interface used by FxConverter"""

    async def get_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return quote currency units per one base currency unit over a date range

        Args:
            base: Source currency code
            quote: Target currency code
            start_date: First date in the requested range
            end_date: Last date in the requested range

        Returns:
            Rates keyed by calendar date
        """
