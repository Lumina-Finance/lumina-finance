from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Protocol

import httpx

from app.config import FRANKFURTER_BASE_URL
from app.schemas.fx import FxIssueReason, FxRateIssue, FxStatus

class FxRateError(RuntimeError):
    """Base error for FX rate lookups."""


class FxRateNotFoundError(FxRateError):
    """Raised when the provider has no rate for a currency pair."""


class FxProviderUnavailableError(FxRateError):
    """Raised when the provider endpoint cannot serve rates."""


class FxRateResponseError(FxProviderUnavailableError):
    """Raised when the provider returns an invalid payload."""


class FxRateProvider(Protocol):
    """Provider interface used by FxConverter."""

    async def get_rate(self, base: str, quote: str, rate_date: date) -> Decimal:
        """Return quote currency units per one base currency unit."""

    async def get_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return quote currency units per one base currency unit over a date range."""


@dataclass(frozen=True)
class FxRateKey:
    """Unique lookup key for request-scoped FX rate memoization."""

    date: date
    base: str
    quote: str


class FrankfurterProvider:
    """Async provider for Frankfurter v2 exchange rates."""

    def __init__(
        self,
        *,
        base_url: str = FRANKFURTER_BASE_URL,
        client: httpx.AsyncClient | None = None,
        timeout: float = 5.0,
    ):
        """Initialize the provider with an optional reusable HTTP client."""
        self.base_url = base_url.rstrip("/")
        self.client = client
        self.timeout = timeout

    async def get_rate(self, base: str, quote: str, rate_date: date) -> Decimal:
        """Return quote currency units per one base currency unit."""
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
        response = await _request_rate(client, self.base_url, base, quote, rate_date)
        return _parse_rate(response.json(), expected_base=base, expected_quote=quote)

    async def get_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return quote currency units per one base currency unit over a date range."""
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
        response = await _request_rates(client, self.base_url, base, quote, start_date, end_date)
        return _parse_rates(response.json(), expected_base=base, expected_quote=quote)


class FxConverter:
    """Convert minor-unit amounts with request-scoped FX rate memoization."""

    def __init__(
        self,
        *,
        provider: FxRateProvider | None = None,
        currency_exponents: dict[str, int] | None = None,
    ):
        """Initialize a converter with per-instance rate and failure memoization."""
        self.provider = provider or FrankfurterProvider()
        self.currency_exponents = currency_exponents or {}
        self.rates: dict[FxRateKey, Decimal] = {}
        self.failed_rates: dict[FxRateKey, FxIssueReason] = {}
        self.recorded_failed_rates: set[FxRateKey] = set()
        self.used_failure_reasons: list[FxIssueReason] = []
        self.used_fx = False
        self.success_count = 0
        self.missing_pairs: list[FxRateIssue] = []

    async def convert_minor_units(
        self,
        amount: int,
        *,
        base: str,
        quote: str,
        rate_date: date,
    ) -> int | None:
        """Convert an amount from base currency minor units into quote currency minor units."""
        normalized_base = base.upper()
        normalized_quote = quote.upper()
        if normalized_base == normalized_quote:
            return amount
        if amount == 0:
            return 0

        self.used_fx = True
        key = FxRateKey(rate_date, normalized_base, normalized_quote)
        if key in self.failed_rates:
            self._record_missing_pair(key, self.failed_rates[key])
            return None

        try:
            rate = await self._get_rate(key)
        except FxRateNotFoundError:
            self.failed_rates[key] = "rate_not_found"
            self._record_missing_pair(key, "rate_not_found")
            return None
        except FxProviderUnavailableError:
            self.failed_rates[key] = "provider_unavailable"
            self._record_missing_pair(key, "provider_unavailable")
            return None

        return convert_minor_units(
            amount,
            rate=rate,
            base_exponent=self.currency_exponents[normalized_base],
            quote_exponent=self.currency_exponents[normalized_quote],
        )

    async def prefetch_rates(self, *, base: str, quote: str, start_date: date, end_date: date) -> None:
        """Load a pair's date-window rates into this converter's request-local cache."""
        normalized_base = base.upper()
        normalized_quote = quote.upper()
        if normalized_base == normalized_quote or start_date > end_date:
            return

        dates = _date_range(start_date, end_date)
        try:
            rates = await self.provider.get_rates(normalized_base, normalized_quote, start_date, end_date)
        except FxRateNotFoundError:
            for rate_date in dates:
                self.failed_rates[FxRateKey(rate_date, normalized_base, normalized_quote)] = "rate_not_found"
            return
        except FxProviderUnavailableError:
            for rate_date in dates:
                self.failed_rates[FxRateKey(rate_date, normalized_base, normalized_quote)] = "provider_unavailable"
            return

        for rate_date in dates:
            key = FxRateKey(rate_date, normalized_base, normalized_quote)
            if rate_date in rates:
                self.rates[key] = rates[rate_date]
            else:
                self.failed_rates[key] = "rate_not_found"

    def get_status(self) -> FxStatus:
        """Return the conversion status accumulated by this converter."""
        if not self.used_fx:
            return FxStatus(state="none")
        if not self.missing_pairs:
            return FxStatus(state="complete")
        if self.success_count == 0 and all(reason == "provider_unavailable" for reason in self.used_failure_reasons):
            return FxStatus(state="unavailable", missing_pairs=self.missing_pairs)
        return FxStatus(state="incomplete", missing_pairs=self.missing_pairs)

    async def _get_rate(self, key: FxRateKey) -> Decimal:
        if key not in self.rates:
            self.rates[key] = await self.provider.get_rate(key.base, key.quote, key.date)
        self.success_count += 1
        return self.rates[key]

    def _record_missing_pair(self, key: FxRateKey, reason: FxIssueReason) -> None:
        if key not in self.recorded_failed_rates:
            self.recorded_failed_rates.add(key)
            self.used_failure_reasons.append(reason)
        if any(pair.base == key.base and pair.quote == key.quote for pair in self.missing_pairs):
            return
        self.missing_pairs.append(FxRateIssue(
            base=key.base,
            quote=key.quote,
        ))


async def _request_rate(
    client: httpx.AsyncClient,
    base_url: str,
    base: str,
    quote: str,
    rate_date: date,
) -> httpx.Response:
    try:
        response = await client.get(
            f"{base_url}/v2/rate/{base}/{quote}",
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
    base_url: str,
    base: str,
    quote: str,
    start_date: date,
    end_date: date,
) -> httpx.Response:
    try:
        response = await client.get(
            f"{base_url}/v2/rates",
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


def _parse_rate(payload: dict[str, Any], *, expected_base: str, expected_quote: str) -> Decimal:
    return _parse_rate_record(payload, expected_base=expected_base, expected_quote=expected_quote)[1]


def _parse_rates(payload: Any, *, expected_base: str, expected_quote: str) -> dict[date, Decimal]:
    if not isinstance(payload, list):
        raise FxRateResponseError("FX provider returned an invalid rate series")

    rates: dict[date, Decimal] = {}
    for item in payload:
        rate_date, rate = _parse_rate_record(item, expected_base=expected_base, expected_quote=expected_quote)
        rates[rate_date] = rate
    return rates


def _parse_rate_record(payload: Any, *, expected_base: str, expected_quote: str) -> tuple[date, Decimal]:
    if not isinstance(payload, dict):
        raise FxRateResponseError("FX provider returned an invalid rate")
    if str(payload.get("base", "")).upper() != expected_base or str(payload.get("quote", "")).upper() != expected_quote:
        raise FxRateResponseError("FX provider returned an unexpected currency pair")

    try:
        rate_date = date.fromisoformat(str(payload["date"]))
        rate = Decimal(str(payload["rate"]))
    except (KeyError, InvalidOperation, ValueError) as exc:
        raise FxRateResponseError("FX provider returned an invalid rate") from exc

    if not rate.is_finite() or rate <= 0:
        raise FxRateResponseError("FX provider returned an invalid rate")
    return rate_date, rate


def convert_minor_units(
    amount: int,
    *,
    rate: Decimal,
    base_exponent: int,
    quote_exponent: int,
) -> int:
    """Convert minor units using currency exponents and round to the quote minor unit."""
    base_units = Decimal(10) ** base_exponent
    quote_units = Decimal(10) ** quote_exponent
    converted = (Decimal(amount) / base_units) * rate * quote_units
    return int(converted.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _date_range(start_date: date, end_date: date) -> list[date]:
    return [date.fromordinal(ordinal) for ordinal in range(start_date.toordinal(), end_date.toordinal() + 1)]
