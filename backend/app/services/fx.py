from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Literal, Protocol

import httpx

from app.config import FRANKFURTER_BASE_URL

FxState = Literal["none", "complete", "incomplete", "unavailable"]
FxIssueReason = Literal["rate_not_found", "provider_unavailable"]


@dataclass
class FxRateIssue:
    """Details for a currency pair that could not be converted."""

    base: str
    quote: str
    date: date
    reason: FxIssueReason


@dataclass
class FxStatus:
    """FX conversion status for a backend calculation."""

    state: FxState = "none"
    missing_pairs: list[FxRateIssue] = field(default_factory=list)


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


@dataclass(frozen=True)
class FxRateKey:
    """Unique lookup key for request-scoped FX rate memoization."""

    date: date
    base: str
    quote: str


class FrankfurterProvider:
    """Async provider for Frankfurter v2 single-pair exchange rates."""

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

    def get_status(self) -> FxStatus:
        """Return the conversion status accumulated by this converter."""
        if not self.used_fx:
            return FxStatus(state="none")
        if not self.missing_pairs:
            return FxStatus(state="complete")
        if self.success_count == 0 and all(pair.reason == "provider_unavailable" for pair in self.missing_pairs):
            return FxStatus(state="unavailable", missing_pairs=self.missing_pairs)
        return FxStatus(state="incomplete", missing_pairs=self.missing_pairs)

    async def _get_rate(self, key: FxRateKey) -> Decimal:
        if key not in self.rates:
            self.rates[key] = await self.provider.get_rate(key.base, key.quote, key.date)
        self.success_count += 1
        return self.rates[key]

    def _record_missing_pair(self, key: FxRateKey, reason: FxIssueReason) -> None:
        if any(pair.base == key.base and pair.quote == key.quote and pair.date == key.date for pair in self.missing_pairs):
            return
        self.missing_pairs.append(FxRateIssue(
            base=key.base,
            quote=key.quote,
            date=key.date,
            reason=reason,
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


def _parse_rate(payload: dict[str, Any], *, expected_base: str, expected_quote: str) -> Decimal:
    if str(payload.get("base", "")).upper() != expected_base or str(payload.get("quote", "")).upper() != expected_quote:
        raise FxRateResponseError("FX provider returned an unexpected currency pair")

    try:
        rate = Decimal(str(payload["rate"]))
    except (KeyError, InvalidOperation, ValueError) as exc:
        raise FxRateResponseError("FX provider returned an invalid rate") from exc

    if not rate.is_finite() or rate <= 0:
        raise FxRateResponseError("FX provider returned an invalid rate")
    return rate


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
