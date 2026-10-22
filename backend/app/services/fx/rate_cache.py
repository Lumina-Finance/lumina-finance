"""Exchange rates cached in ValKey across requests, in front of the rate provider"""

import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from app.services.fx.errors import FxRateNotFoundError, FxRateRejectedError
from app.services.fx.provider import FxRateProvider
from app.utils.dates import get_dates_in_range
from app.valkey_store import ValkeyEntry, ValkeyStore, get_valkey

logger = logging.getLogger(__name__)

# An answer about a date at least this long before the day it was fetched is settled. The provider
# blends central banks that publish at different times, so a recent day's answer can still change
SETTLED_RATE_AGE = timedelta(days=7)

# How long a rate, or the provider having none, for a date that isn't settled is reused before the
# provider is asked again
RECENT_RATE_TTL = timedelta(hours=1)

# A settled rate no longer changes, but it still expires, so a rate nobody asks for again leaves
# the cache by itself and a corrected one is picked up within half a year
SETTLED_RATE_TTL = timedelta(days=180)

# How long the provider having no rate for a settled date is remembered. The provider can later add
# a currency or fill in past dates, so it is asked about again weekly
SETTLED_MISSING_RATE_TTL = timedelta(days=7)

# Stored in place of a rate when the provider said it has none. Never a number, so it cannot be
# read as one
MISSING_RATE = b"missing"

# Changing how a key or value is written starts the cache clean without a flush
_KEY_VERSION = "v2"


def _key(base: str, quote: str, rate_date: date) -> str:
    """Return the key one pair's rate for one date is stored under

    A rate is only ever stored under the date the provider published it for
    """
    return f"fx:{_KEY_VERSION}:{base}:{quote}:{rate_date.isoformat()}"


def _ttl(rate_date: date, now: datetime, *, is_missing: bool) -> timedelta:
    """Return how long an answer about a date lives, by how settled the date is on the day it is fetched

    A recent missing date lives as long as a recent rate. A lookup reads a week of dates, so a shorter
    life for the weekend days in it would have every lookup ask the provider again within minutes, and
    fail during a short outage even though every rate it needs is cached
    """
    is_settled = rate_date <= now.date() - SETTLED_RATE_AGE
    if is_settled:
        return SETTLED_MISSING_RATE_TTL if is_missing else SETTLED_RATE_TTL
    return RECENT_RATE_TTL


def _parse_rate(value: bytes) -> Decimal | None:
    """Return a stored rate, or None when it isn't one the provider could have given

    A rate must be finite and above zero, as the provider's own parser requires, so a corrupt or
    tampered entry is fetched again instead of converting amounts to nothing or to nonsense
    """
    try:
        rate = Decimal(value.decode())
    except UnicodeDecodeError, InvalidOperation:
        return None
    return rate if rate.is_finite() and rate > 0 else None


class CachedFxRateProvider:
    """Answer rate lookups from ValKey, asking the provider only for what it lacks

    Without a store, or while ValKey fails, every lookup goes to the provider, exactly as if there
    were no cache. A provider failure is never stored, and a rate already stored is never replaced
    by the provider having none

    Time spent on ValKey is not charged to the request's lookup budget, which caps the time spent
    waiting on the provider. ValKey's own timeout and cooldown already bound what it can cost, and
    an answer inside that timeout is still far faster than the provider call it saves, so charging
    it would only leave less of the budget for the dates the cache lacks
    """

    def __init__(self, provider: FxRateProvider) -> None:
        """Wrap the rate provider with the cache

        Args:
            provider: Provider asked for rates the cache lacks
        """
        self.provider = provider

    async def get_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return quote currency units per one base currency unit over a date range

        Only the span from the first to the last date the cache lacks is asked for, in one call. If
        that call fails as unavailable, the whole lookup does, even when some of the range is stored

        Args:
            base: Source currency code
            quote: Target currency code
            start_date: First date in the requested range
            end_date: Last date in the requested range

        Returns:
            Rates keyed by calendar date, leaving out dates with no rate

        Raises:
            FxProviderUnavailableError: The provider couldn't be reached for dates the cache lacks
            FxRateRejectedError: The provider refused the request
        """
        base, quote = base.upper(), quote.upper()
        store = get_valkey()
        if store is None:
            return await self.provider.get_rates(base, quote, start_date, end_date)

        dates = get_dates_in_range(start_date, end_date)
        answers = await _read(store, base, quote, dates)
        rates = {rate_date: rate for rate_date, rate in answers.items() if rate is not None}
        uncached_dates = [rate_date for rate_date in dates if rate_date not in answers]
        if not uncached_dates:
            return rates

        now = datetime.now(UTC)
        span = get_dates_in_range(uncached_dates[0], uncached_dates[-1])
        try:
            fetched = await self.provider.get_rates(base, quote, span[0], span[-1])
        except FxRateRejectedError:
            raise
        except FxRateNotFoundError:
            # The same answer as a range with no rate on any date, which the converter reads as each
            # date missing, exactly as it reads this error
            fetched = {}

        span_rates = {rate_date: fetched.get(rate_date) for rate_date in span}
        await _store(store, base, quote, span_rates, now)
        rates.update({rate_date: rate for rate_date, rate in span_rates.items() if rate is not None})
        return rates


async def _read(store: ValkeyStore, base: str, quote: str, dates: list[date]) -> dict[date, Decimal | None]:
    """Return the stored answers for some dates, leaving out the dates with none

    Returns:
        A rate for a date with one, None for a date the provider had no rate for
    """
    keys = {rate_date: _key(base, quote, rate_date) for rate_date in dates}
    stored = await store.get_many(list(keys.values()))

    answers: dict[date, Decimal | None] = {}
    for rate_date, key in keys.items():
        value = stored.get(key)
        if value is None:
            continue
        if value == MISSING_RATE:
            answers[rate_date] = None
            continue

        rate = _parse_rate(value)
        if rate is None:
            logger.warning("Ignored an unreadable cached %s/%s exchange rate", base, quote)
            continue
        answers[rate_date] = rate
    return answers


async def _store(
    store: ValkeyStore,
    base: str,
    quote: str,
    answers: dict[date, Decimal | None],
    fetched_at: datetime,
) -> None:
    """Store the provider's answers

    A rate replaces what is there. A missing answer is written to keep what is there, so a rate
    already stored is never replaced by the provider now having none
    """
    found = [
        ValkeyEntry(_key(base, quote, rate_date), str(rate).encode(), _ttl(rate_date, fetched_at, is_missing=False))
        for rate_date, rate in answers.items()
        if rate is not None
    ]
    missing = [
        ValkeyEntry(_key(base, quote, rate_date), MISSING_RATE, _ttl(rate_date, fetched_at, is_missing=True))
        for rate_date, rate in answers.items()
        if rate is None
    ]
    await store.set_many(found)
    await store.set_many(missing, keep_existing=True)
