"""Foreign exchange conversion service"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.schemas.fx import FxIssueReason, FxRateIssue, FxStatus
from app.services.allowance.require import is_asked_about
from app.services.fx.errors import FxProviderUnavailableError, FxRateNotFoundError
from app.services.fx.frankfurter_provider import FrankfurterProvider
from app.services.fx.provider import FxRateProvider
from app.services.fx.rate_cache import CachedFxRateProvider
from app.services.fx.used_pairs import record_used_pair
from app.utils.date_window import EARLIEST_ALLOWED_DATE, get_latest_calendar_today
from app.utils.dates import get_dates_in_range
from app.utils.money import convert_minor_units_between_currencies as convert_minor_units

# How far back a date with no published rate looks for one. Today's rate is not published until the
# afternoon in Europe, so a conversion uses the latest rate published on or before its date, if that
# is within this long before it
RATE_LOOKBACK = timedelta(days=7)


def _get_latest_rate_date() -> date:
    """Return the last date a rate can exist for, since none is published after today and a date takes the one before it

    Dates outside this and the earliest allowed date answer as rate not found without asking the
    provider. That also keeps one prefetch to a bounded number of dates whatever the account holds
    """
    return get_latest_calendar_today() + RATE_LOOKBACK


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
        withheld_reason: str | None = None,
        find_withheld_reason: Callable[[], Awaitable[str | None]] | None = None,
    ):
        """Initialize a converter with per-instance rate and failure memoization

        Args:
            provider: Optional FX provider implementation
            currency_exponents: Minor-unit exponents keyed by currency code
            withheld_reason: The sentence the installed check gives for refusing conversion between
                currencies, or None to convert. While set, an amount in another currency is left out
                rather than converted, except one from a group-owned record
            find_withheld_reason: Looks the sentence up, called once before the first conversion between
                currencies, so a request that converts nothing never asks
        """
        self.provider = provider or CachedFxRateProvider(FrankfurterProvider())
        self.currency_exponents = currency_exponents or {}
        self.withheld_reason = withheld_reason
        self.find_withheld_reason = find_withheld_reason
        self.has_withheld = False
        self.rates: dict[FxRateKey, Decimal] = {}
        self.failed_rates: dict[FxRateKey, FxIssueReason] = {}
        self.recorded_failed_rates: set[FxRateKey] = set()
        self.used_failure_reasons: list[FxIssueReason] = []
        self.used_fx = False
        self.success_count = 0
        self.missing_pairs: list[FxRateIssue] = []

        # Pairs already recorded as in use, so a request's many conversions of one pair record it once
        self.recorded_pairs: set[tuple[str, str]] = set()

    def clone(self) -> FxConverter:
        """Return an independent converter that starts with this one's loaded rates and failures

        Lets several metrics of one request share a prefetch while each reports its own status
        """
        cloned = FxConverter(
            provider=self.provider,
            currency_exponents=self.currency_exponents,
            withheld_reason=self.withheld_reason,
            find_withheld_reason=self.find_withheld_reason,
        )
        cloned.rates = self.rates.copy()
        cloned.failed_rates = self.failed_rates.copy()
        cloned.recorded_pairs = self.recorded_pairs
        return cloned

    def withholds(self, group_id: uuid.UUID | None = None) -> bool:
        """Return whether an amount in another currency from a record is left out instead of converted

        Args:
            group_id: The group owning the record, or None for one the user owns alone, since a
                group-owned record is never withheld
        """
        return self.withheld_reason is not None and is_asked_about(group_id)

    async def _settle_withheld_reason(self) -> None:
        """Look the reason up the first time a conversion between currencies is asked for"""
        if self.find_withheld_reason is not None:
            self.withheld_reason = await self.find_withheld_reason()
            self.find_withheld_reason = None

    async def convert_minor_units(
        self,
        amount: int,
        *,
        base: str,
        quote: str,
        rate_date: date,
        group_id: uuid.UUID | None = None,
    ) -> int | None:
        """Convert a minor-unit amount into a target currency

        Args:
            amount: Source amount in base currency minor units
            base: Source currency code
            quote: Target currency code
            rate_date: Date for the conversion rate
            group_id: The group owning the record the amount comes from, which converts even while the
                converter withholds, or None for an amount from a record the user owns alone

        Returns:
            Converted amount in quote currency minor units, or None when the rate is unavailable or the
            conversion is withheld
        """
        normalized_base = base.upper()
        normalized_quote = quote.upper()
        if normalized_base == normalized_quote:
            return amount
        if amount == 0:
            return 0
        await self._settle_withheld_reason()
        if self.withholds(group_id):
            self.has_withheld = True
            return None

        self.used_fx = True
        await self._record_pair(normalized_base, normalized_quote)
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
        start_date = max(start_date, EARLIEST_ALLOWED_DATE)
        end_date = min(end_date, _get_latest_rate_date())
        if normalized_base == normalized_quote or start_date > end_date:
            return

        # Prefetching can't tell a group-owned amount from the user's own. While withholding, only group-owned
        # amounts convert, and each looks its rate up on its own
        await self._settle_withheld_reason()
        if self.withheld_reason is not None:
            return

        await self._record_pair(normalized_base, normalized_quote)
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
        if self.has_withheld:
            status = FxStatus(state="none", withheld_reason=self.withheld_reason)
            return status
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
            if not EARLIEST_ALLOWED_DATE <= key.date <= _get_latest_rate_date():
                raise FxRateNotFoundError(f"No FX rate found for {key.base}/{key.quote} on {key.date.isoformat()}")
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

    async def _record_pair(self, base: str, quote: str) -> None:
        """Record a pair the signed-in user's request converts, once for this converter and its clones

        Args:
            base: Normalized source currency code
            quote: Normalized target currency code
        """
        if (base, quote) not in self.recorded_pairs:
            self.recorded_pairs.add((base, quote))
            await record_used_pair(base, quote)

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
