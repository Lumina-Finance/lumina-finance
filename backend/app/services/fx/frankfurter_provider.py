"""Frankfurter foreign exchange rate provider"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import date
from decimal import Decimal
from functools import partial
from time import monotonic  # By name, so a test can drive this clock without the event loop's
from typing import TypeVar

import httpx

from app.config.fx import FRANKFURTER_URL
from app.http_client import build_http_client
from app.services.fx.errors import FxProviderUnavailableError
from app.services.fx.frankfurter_request_helpers import request_frankfurter_rates_response
from app.services.fx.lookup_budget import get_current_lookup_budget
from app.services.fx.rate_parser_helpers import parse_rates

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
            timeout: Longest one attempt may take in seconds, shortened to what the request's budget has left
            retry_attempts: Number of provider lookup attempts before surfacing an FX error
            retry_delay_seconds: Delay between provider lookup attempts
        """
        self.url = url.rstrip("/")
        self.client = client
        self.timeout = timeout
        self.retry_attempts = retry_attempts
        self.retry_delay_seconds = retry_delay_seconds

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

    async def _run_provider_lookup_with_retries(self, lookup: Callable[[float], Awaitable[_T]]) -> _T:
        """Run one provider lookup, retrying only transient failures within the request's budget

        A missing rate is final, so it raises on the first answer. A transient failure is tried
        again until the attempts run out or the budget leaves no room for another pause and try

        Args:
            lookup: Provider request and parser work to attempt, given the attempt's timeout

        Returns:
            Parsed provider lookup result

        Raises:
            FxProviderUnavailableError: Every attempt failed transiently, or the budget was spent
            FxRateNotFoundError: The provider has no rate for the lookup
        """
        budget = get_current_lookup_budget()
        last_error: FxProviderUnavailableError | None = None

        for attempt in range(1, self.retry_attempts + 1):
            timeout = self.timeout if budget is None else min(self.timeout, budget.remaining)
            if timeout <= 0:
                raise last_error or FxProviderUnavailableError("FX lookup budget for this request is spent")

            started_at = monotonic()
            try:
                # httpx times each phase of a request separately, so a slowly trickling answer could
                # outlast its timeout. The deadline holds the whole attempt to it
                async with asyncio.timeout(timeout):
                    return await lookup(timeout)
            except TimeoutError as exc:
                last_error = FxProviderUnavailableError("FX provider request timed out")
                last_error.__cause__ = exc
            except FxProviderUnavailableError as exc:
                last_error = exc
            finally:
                if budget is not None:
                    budget.charge(monotonic() - started_at)

            is_last_attempt = attempt == self.retry_attempts
            if is_last_attempt or (budget is not None and budget.remaining <= self.retry_delay_seconds):
                break
            await asyncio.sleep(self.retry_delay_seconds)
            if budget is not None:
                budget.charge(self.retry_delay_seconds)

        if last_error is not None:
            raise last_error
        raise RuntimeError("FX provider retry attempts ended before a lookup was attempted")

    async def _request_and_parse_rates(
        self,
        client: httpx.AsyncClient,
        base: str,
        quote: str,
        start_date: date,
        end_date: date,
        timeout: float,
    ) -> dict[date, Decimal]:
        """Request and parse FX rates over a date range

        Args:
            client: HTTP client used for the provider request
            base: Normalized source currency code
            quote: Normalized target currency code
            start_date: First date in the requested range
            end_date: Last date in the requested range
            timeout: Seconds this attempt may take

        Returns:
            Rates keyed by calendar date
        """
        response = await request_frankfurter_rates_response(client, self.url, base, quote, start_date, end_date, timeout)
        rates = parse_rates(response.json(), expected_base=base, expected_quote=quote)
        return rates
