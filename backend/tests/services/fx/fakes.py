"""Test doubles shared by the exchange rate tests"""

from datetime import date
from decimal import Decimal


class FakeProvider:
    """Small test double for FxRateProvider

    Converter tests should not hit Frankfurter or mock HTTP details. Like the real provider, it
    answers a range with the published rates inside it, and tests assert how it was asked
    """

    def __init__(
        self,
        published: dict[tuple[str, str], dict[date, Decimal]] | None = None,
        errors: dict[tuple[str, str], Exception] | None = None,
    ):
        """Declare what the provider has published and which pairs fail, both keyed by base and quote"""
        self.published = published or {}
        self.errors = errors or {}

        # Every range the provider was asked for, so tests can assert how often and how wide
        self.calls: list[tuple[str, str, date, date]] = []

    async def get_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return the published rates inside the range or raise the pair's configured error"""
        self.calls.append((base, quote, start_date, end_date))
        if (base, quote) in self.errors:
            raise self.errors[(base, quote)]
        return {rate_date: rate for rate_date, rate in self.published.get((base, quote), {}).items() if start_date <= rate_date <= end_date}
