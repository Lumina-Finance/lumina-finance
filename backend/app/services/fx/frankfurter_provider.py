"""Frankfurter foreign exchange rate provider"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import date
from decimal import Decimal
from functools import partial
from typing import TypeVar

import httpx

from app.config.fx import FRANKFURTER_URL
from app.http_client import build_http_client
from app.services.fx.errors import FxRateError
from app.services.fx.frankfurter_request_helpers import (
    request_frankfurter_rate_response,
    request_frankfurter_rates_response,
)
from app.services.fx.rate_parser_helpers import parse_rate, parse_rates

DEFAULT_FX_PROVIDER_RETRY_ATTEMPTS = 3
DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS = 0.5
_T = TypeVar("_T")


class FrankfurterProvider:
    """Async provider for Frankfurter v2 exchange rates"""

    def __init__(
        self,
        *,
        url: str = FRANKFURTER_URL,
        client: httpx.AsyncClient | None = None,
        timeout: float = 5.0,
        retry_attempts: int = DEFAULT_FX_PROVIDER_RETRY_ATTEMPTS,
        retry_delay_seconds: float = DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS,
    ):
        """Initialize the provider with an optional reusable HTTP client

        Args:
            url: Base URL for the Frankfurter API
            client: Optional reusable HTTP client
            timeout: HTTP request timeout in seconds when creating a client
            retry_attempts: Number of provider lookup attempts before surfacing an FX error
            retry_delay_seconds: Delay between provider lookup attempts
        """
        self.url = url.rstrip("/")
        self.client = client
        self.timeout = timeout
        self.retry_attempts = retry_attempts
        self.retry_delay_seconds = retry_delay_seconds

    async def get_rate(self, base: str, quote: str, rate_date: date) -> Decimal:
        """Return quote currency units per one base currency unit

        Args:
            base: Source currency code
            quote: Target currency code
            rate_date: Date for the requested rate

        Returns:
            Quote currency units per one base currency unit
        """
        normalized_base = base.upper()
        normalized_quote = quote.upper()
        if self.client is not None:
            return await self._get_rate(self.client, normalized_base, normalized_quote, rate_date)

        async with build_http_client(timeout=self.timeout) as client:
            return await self._get_rate(client, normalized_base, normalized_quote, rate_date)

    async def _get_rate(
        self,
        client: httpx.AsyncClient,
        base: str,
        quote: str,
        rate_date: date,
    ) -> Decimal:
        """Return one parsed FX rate using an HTTP client

        Args:
            client: HTTP client used for the provider request
            base: Normalized source currency code
            quote: Normalized target currency code
            rate_date: Date for the requested rate

        Returns:
            Quote currency units per one base currency unit
        """
        return await self._run_provider_lookup_with_retries(
            partial(self._request_and_parse_rate, client, base, quote, rate_date),
        )

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
        normalized_base = base.upper()
        normalized_quote = quote.upper()
        if self.client is not None:
            return await self._get_rates(self.client, normalized_base, normalized_quote, start_date, end_date)

        async with build_http_client(timeout=self.timeout) as client:
            return await self._get_rates(client, normalized_base, normalized_quote, start_date, end_date)

    async def _get_rates(
        self,
        client: httpx.AsyncClient,
        base: str,
        quote: str,
        start_date: date,
        end_date: date,
    ) -> dict[date, Decimal]:
        """Return parsed FX rates over a date range using an HTTP client

        Args:
            client: HTTP client used for the provider request
            base: Normalized source currency code
            quote: Normalized target currency code
            start_date: First date in the requested range
            end_date: Last date in the requested range

        Returns:
            Rates keyed by calendar date
        """
        return await self._run_provider_lookup_with_retries(
            partial(self._request_and_parse_rates, client, base, quote, start_date, end_date),
        )

    async def _run_provider_lookup_with_retries(self, lookup: Callable[[], Awaitable[_T]]) -> _T:
        """Run one provider lookup with retry policy before surfacing the final FX error

        Args:
            lookup: Provider request and parser work to attempt

        Returns:
            Parsed provider lookup result
        """
        last_error: FxRateError | None = None

        for attempt in range(1, self.retry_attempts + 1):
            try:
                return await lookup()
            except FxRateError as exc:
                last_error = exc
                if attempt == self.retry_attempts:
                    break
                await asyncio.sleep(self.retry_delay_seconds)

        if last_error is not None:
            raise last_error
        raise RuntimeError("FX provider retry attempts ended before a lookup was attempted")

    async def _request_and_parse_rate(
        self,
        client: httpx.AsyncClient,
        base: str,
        quote: str,
        rate_date: date,
    ) -> Decimal:
        """Request and parse one FX rate response

        Args:
            client: HTTP client used for the provider request
            base: Normalized source currency code
            quote: Normalized target currency code
            rate_date: Date for the requested rate

        Returns:
            Quote currency units per one base currency unit
        """
        response = await request_frankfurter_rate_response(client, self.url, base, quote, rate_date)
        rate = parse_rate(response.json(), expected_base=base, expected_quote=quote)
        return rate

    async def _request_and_parse_rates(
        self,
        client: httpx.AsyncClient,
        base: str,
        quote: str,
        start_date: date,
        end_date: date,
    ) -> dict[date, Decimal]:
        """Request and parse FX rates over a date range

        Args:
            client: HTTP client used for the provider request
            base: Normalized source currency code
            quote: Normalized target currency code
            start_date: First date in the requested range
            end_date: Last date in the requested range

        Returns:
            Rates keyed by calendar date
        """
        response = await request_frankfurter_rates_response(client, self.url, base, quote, start_date, end_date)
        rates = parse_rates(response.json(), expected_base=base, expected_quote=quote)
        return rates
