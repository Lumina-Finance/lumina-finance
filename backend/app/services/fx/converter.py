"""Foreign exchange conversion service"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.schemas.fx import FxIssueReason, FxRateIssue, FxStatus
from app.services.fx.errors import FxProviderUnavailableError, FxRateNotFoundError
from app.services.fx.frankfurter_provider import FrankfurterProvider
from app.services.fx.provider import FxRateProvider
from app.services.fx.rate_cache import CachedFxRateProvider
from app.utils.dates import get_dates_in_range
from app.utils.money import convert_minor_units_between_currencies as convert_minor_units

# How far back a date with no published rate looks for one. Today's rate is not published until the
# afternoon in Europe, so a conversion uses the latest rate published on or before its date, if that
# is within this long before it
RATE_LOOKBACK = timedelta(days=7)


@dataclass(frozen=True)
class FxRateKey:
    """Unique lookup key for request-scoped FX rate memoization"""

    date: date
    base: str
    quote: str


class FxConverter:
    """Convert minor-unit amounts with request-scoped FX rate memoization"""

    def __init__(
        self,
        *,
        provider: FxRateProvider | None = None,
        currency_exponents: dict[str, int] | None = None,
    ):
        """Initialize a converter with per-instance rate and failure memoization

        Args:
            provider: Optional FX provider implementation
            currency_exponents: Minor-unit exponents keyed by currency code
        """
        self.provider = provider or CachedFxRateProvider(FrankfurterProvider())
        self.currency_exponents = currency_exponents or {}
        self.rates: dict[FxRateKey, Decimal] = {}
        self.failed_rates: dict[FxRateKey, FxIssueReason] = {}
        self.recorded_failed_rates: set[FxRateKey] = set()
        self.used_failure_reasons: list[FxIssueReason] = []
        self.used_fx = False
        self.success_count = 0
        self.missing_pairs: list[FxRateIssue] = []

    def clone(self) -> FxConverter:
        """Return an independent converter that starts with this one's loaded rates and failures

        Lets several metrics of one request share a prefetch while each reports its own status
        """
        cloned = FxConverter(provider=self.provider, currency_exponents=self.currency_exponents)
        cloned.rates = self.rates.copy()
        cloned.failed_rates = self.failed_rates.copy()
        return cloned

    async def convert_minor_units(
        self,
        amount: int,
        *,
        base: str,
        quote: str,
        rate_date: date,
    ) -> int | None:
        """Convert a minor-unit amount into a target currency

        Args:
            amount: Source amount in base currency minor units
            base: Source currency code
            quote: Target currency code
            rate_date: Date for the conversion rate

        Returns:
            Converted amount in quote currency minor units, or None when the rate is unavailable
        """
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

        converted_amount = convert_minor_units(
            amount,
            rate=rate,
            base_exponent=self.currency_exponents[normalized_base],
            quote_exponent=self.currency_exponents[normalized_quote],
        )
        return converted_amount

    async def prefetch_rates(self, *, base: str, quote: str, start_date: date, end_date: date) -> None:
        """Load a pair's date-window rates into this converter's local cache

        Args:
            base: Source currency code
            quote: Target currency code
            start_date: First date in the requested range
            end_date: Last date in the requested range
        """
        normalized_base = base.upper()
        normalized_quote = quote.upper()
        if normalized_base == normalized_quote or start_date > end_date:
            return

        dates = get_dates_in_range(start_date, end_date)
        try:
            rates = await self._fetch_latest_rates(normalized_base, normalized_quote, start_date, end_date)
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
        """Return the conversion status accumulated by this converter

        Returns:
            FX conversion status for all conversions attempted by this converter
        """
        if not self.used_fx:
            status = FxStatus(state="none")
            return status
        if not self.missing_pairs:
            status = FxStatus(state="complete")
            return status
        if self.success_count == 0 and all(reason == "provider_unavailable" for reason in self.used_failure_reasons):
            status = FxStatus(state="unavailable", missing_pairs=self.missing_pairs)
            return status

        status = FxStatus(state="incomplete", missing_pairs=self.missing_pairs)
        return status

    async def _get_rate(self, key: FxRateKey) -> Decimal:
        """Return a cached rate or fetch it from the provider

        Args:
            key: Currency pair and date lookup key

        Returns:
            Quote currency units per one base currency unit

        Raises:
            FxRateNotFoundError: No rate was published on the date or within the lookback before it
            FxProviderUnavailableError: The provider couldn't be reached
        """
        if key not in self.rates:
            rates = await self._fetch_latest_rates(key.base, key.quote, key.date, key.date)
            if key.date not in rates:
                raise FxRateNotFoundError(f"No FX rate found for {key.base}/{key.quote} on {key.date.isoformat()}")
            self.rates[key] = rates[key.date]
        self.success_count += 1
        return self.rates[key]

    async def _fetch_latest_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return each date's rate, which is the latest published on or before it within the lookback

        Asks the provider for the lookback before the first date as well, since a date with no rate of
        its own, such as today before the afternoon in Europe, takes the one before it

        Args:
            base: Normalized source currency code
            quote: Normalized target currency code
            start_date: First date in the requested range
            end_date: Last date in the requested range

        Returns:
            Rates keyed by calendar date, leaving out dates with none inside the lookback
        """
        published = await self.provider.get_rates(base, quote, start_date - RATE_LOOKBACK, end_date)

        rates: dict[date, Decimal] = {}
        latest_date: date | None = None
        for rate_date in get_dates_in_range(start_date - RATE_LOOKBACK, end_date):
            if rate_date in published:
                latest_date = rate_date
            if rate_date >= start_date and latest_date is not None and rate_date - latest_date <= RATE_LOOKBACK:
                rates[rate_date] = published[latest_date]
        return rates

    def _record_missing_pair(self, key: FxRateKey, reason: FxIssueReason) -> None:
        """Record a failed currency pair once for the converter status

        Args:
            key: Currency pair and date lookup key that could not be converted
            reason: Reason the provider could not supply the rate
        """
        if key not in self.recorded_failed_rates:
            self.recorded_failed_rates.add(key)
            self.used_failure_reasons.append(reason)
        if any(pair.base == key.base and pair.quote == key.quote for pair in self.missing_pairs):
            return

        issue = FxRateIssue(
            base=key.base,
            quote=key.quote,
        )
        self.missing_pairs.append(issue)
