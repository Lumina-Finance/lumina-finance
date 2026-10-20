"""Test doubles shared by the exchange rate tests"""

from datetime import date
from decimal import Decimal


class FakeProvider:
    """Small test double for FxRateProvider

    Converter tests should not hit Frankfurter or mock HTTP details. This fake lets
    each test predeclare rates/errors and then assert how often the provider was used
    """

    def __init__(
        self,
        rates: dict[tuple[str, str, date], Decimal] | None = None,
        rate_ranges: dict[tuple[str, str, date, date], dict[date, Decimal]] | None = None,
        errors: dict[tuple[str, str, date], Exception] | None = None,
        range_errors: dict[tuple[str, str, date, date], Exception] | None = None,
    ):
        """Declare what the provider answers, keyed by the exact arguments of each call"""
        # Success maps are keyed by the exact provider call arguments
        self.rates = rates or {}
        self.rate_ranges = rate_ranges or {}

        # Error maps simulate missing provider data and endpoint failures
        self.errors = errors or {}
        self.range_errors = range_errors or {}

        # Call logs make memoization/prefetch behavior explicit in assertions
        self.calls: list[tuple[str, str, date]] = []
        self.range_calls: list[tuple[str, str, date, date]] = []

    async def get_rate(self, base: str, quote: str, rate_date: date) -> Decimal:
        """Return a fake FX rate or raise the configured error."""
        key = (base, quote, rate_date)
        self.calls.append(key)
        if key in self.errors:
            raise self.errors[key]
        return self.rates[key]

    async def get_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return fake FX rates for a date range or raise the configured error."""
        key = (base, quote, start_date, end_date)
        self.range_calls.append(key)
        if key in self.range_errors:
            raise self.range_errors[key]
        return self.rate_ranges[key]
