"""Frankfurter foreign exchange rate provider"""

from datetime import date
from decimal import Decimal

import httpx

from app.config import FRANKFURTER_URL
from app.services.fx.errors import FxProviderUnavailableError, FxRateNotFoundError
from app.services.fx.rate_parser_helpers import parse_rate, parse_rates


class FrankfurterProvider:
    """Async provider for Frankfurter v2 exchange rates"""

    def __init__(
        self,
        *,
        url: str = FRANKFURTER_URL,
        client: httpx.AsyncClient | None = None,
        timeout: float = 5.0,
    ):
        """Initialize the provider with an optional reusable HTTP client

        Args:
            url: Base URL for the Frankfurter API
            client: Optional reusable HTTP client
            timeout: HTTP request timeout in seconds when creating a client
        """
        self.url = url.rstrip("/")
        self.client = client
        self.timeout = timeout

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

        async with httpx.AsyncClient(timeout=self.timeout) as client:
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
        response = await _request_rate(client, self.url, base, quote, rate_date)
        rate = parse_rate(response.json(), expected_base=base, expected_quote=quote)
        return rate

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

        async with httpx.AsyncClient(timeout=self.timeout) as client:
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
        response = await _request_rates(client, self.url, base, quote, start_date, end_date)
        rates = parse_rates(response.json(), expected_base=base, expected_quote=quote)
        return rates


async def _request_rate(
    client: httpx.AsyncClient,
    url: str,
    base: str,
    quote: str,
    rate_date: date,
) -> httpx.Response:
    """Request one FX rate from Frankfurter

    Args:
        client: HTTP client used for the provider request
        url: Frankfurter API base URL
        base: Source currency code
        quote: Target currency code
        rate_date: Date for the requested rate

    Returns:
        Raw HTTP response from the provider
    """
    try:
        response = await client.get(
            f"{url}/rate/{base}/{quote}",
            params={"date": rate_date.isoformat()},
        )
    except httpx.RequestError as exc:
        raise FxProviderUnavailableError("FX provider request failed") from exc

    if response.status_code == httpx.codes.NOT_FOUND:
        raise FxRateNotFoundError(f"No FX rate found for {base}/{quote} on {rate_date.isoformat()}")
    if response.status_code >= 500:
        raise FxProviderUnavailableError("FX provider endpoint failed")

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise FxRateNotFoundError(f"No FX rate found for {base}/{quote} on {rate_date.isoformat()}") from exc

    return response


async def _request_rates(
    client: httpx.AsyncClient,
    url: str,
    base: str,
    quote: str,
    start_date: date,
    end_date: date,
) -> httpx.Response:
    """Request FX rates over a date range from Frankfurter

    Args:
        client: HTTP client used for the provider request
        url: Frankfurter API base URL
        base: Source currency code
        quote: Target currency code
        start_date: First date in the requested range
        end_date: Last date in the requested range

    Returns:
        Raw HTTP response from the provider
    """
    try:
        response = await client.get(
            f"{url}/rates",
            params={
                "base": base,
                "quotes": quote,
                "from": start_date.isoformat(),
                "to": end_date.isoformat(),
            },
        )
    except httpx.RequestError as exc:
        raise FxProviderUnavailableError("FX provider request failed") from exc

    if response.status_code == httpx.codes.NOT_FOUND:
        raise FxRateNotFoundError(f"No FX rates found for {base}/{quote}")
    if response.status_code >= 500:
        raise FxProviderUnavailableError("FX provider endpoint failed")

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise FxRateNotFoundError(f"No FX rates found for {base}/{quote}") from exc

    return response
