"""The digest of recent exchange rates a browser compares to learn whether converted figures are out of date

Run against the real test ValKey for the recorded pairs, with the provider replaced, so what is checked is when
the digest moves and when it is unknown
"""

import asyncio
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.database import current_user_id_ctx
from app.services.fx import FxConverter, FxProviderUnavailableError, rate_cache, rates_status, used_pairs
from app.services.fx import converter as converter_module
from app.services.fx.rate_cache import CachedFxRateProvider
from app.services.fx.rates_status import get_rates_digest
from app.services.fx.used_pairs import get_used_pairs
from app.valkey_store import ValkeyStore
from tests.services.fx.fakes import FakeProvider

# The moment the digest believes it is. The unsettled window is the 7 days ending on this day
_NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
_WINDOW_DAYS = [date(2026, 10, 20) - timedelta(days=offset) for offset in range(7)]
_EXPONENTS = {"USD": 2, "CAD": 2, "EUR": 2, "GBP": 2}


class SlowProvider(FakeProvider):
    """A provider that answers after a delay, so asks overlap"""

    async def get_rates(self, base, quote, start_date, end_date):
        """Wait, then answer as the fake does"""
        await asyncio.sleep(0.2)
        return await super().get_rates(base, quote, start_date, end_date)


class GatedProvider(FakeProvider):
    """A provider that holds its answer until the test releases it"""

    def __init__(self, *args, **kwargs):
        """Start closed, with a note of when the first ask arrives"""
        super().__init__(*args, **kwargs)
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def get_rates(self, base, quote, start_date, end_date):
        """Say the ask arrived, wait for the release, then answer as the fake does"""
        self.started.set()
        await self.release.wait()
        return await super().get_rates(base, quote, start_date, end_date)


@pytest.fixture(autouse=True)
def fixed_now(freeze_now):
    """Make the digest and the cache read the moment above as now"""
    freeze_now(rates_status, _NOW)
    freeze_now(rate_cache, _NOW)


@pytest.fixture
def user_id():
    """Be a signed-in user, since the converter records the pairs it converts for the current one"""
    identity = uuid4()
    token = current_user_id_ctx.set(identity)
    yield identity
    current_user_id_ctx.reset(token)


def _published(rate: str, *, base: str = "USD", quote: str = "CAD") -> dict[tuple[str, str], dict[date, Decimal]]:
    """Return a provider's rates for one pair on every day of the window"""
    return {(base, quote): {day: Decimal(rate) for day in _WINDOW_DAYS}}


async def _convert(pair: tuple[str, str]) -> None:
    """Convert an amount between two currencies, as any request showing converted figures does"""
    converter = FxConverter(provider=FakeProvider(_published("1.3", base=pair[0], quote=pair[1])), currency_exponents=_EXPONENTS)
    assert await converter.convert_minor_units(100, base=pair[0], quote=pair[1], rate_date=date(2026, 10, 20)) is not None


async def test_converted_pairs_are_recorded_for_the_current_user_only(published_valkey, user_id):
    """Each pair a request converts is recorded for the signed-in user, and a conversion that needs no rate records none"""
    await _convert(("USD", "CAD"))
    await _convert(("USD", "CAD"))
    await _convert(("EUR", "CAD"))
    same_currency = FxConverter(provider=FakeProvider(), currency_exponents=_EXPONENTS)
    assert await same_currency.convert_minor_units(100, base="CAD", quote="CAD", rate_date=date(2026, 10, 20)) == 100

    assert await get_used_pairs(user_id) == [("EUR", "CAD"), ("USD", "CAD")]
    assert await get_used_pairs(uuid4()) == []


async def test_the_digest_moves_when_a_rate_changes_and_not_when_it_does_not(published_valkey, user_id):
    """A changed or lost rate moves the digest, while the same rates, even written with more digits, do not"""
    await _convert(("USD", "CAD"))

    first = await get_rates_digest(user_id, holds_other_currencies=True, provider=FakeProvider(_published("1.30")))
    again = await get_rates_digest(user_id, holds_other_currencies=True, provider=FakeProvider(_published("1.30")))
    written_with_more_digits = await get_rates_digest(user_id, holds_other_currencies=True, provider=FakeProvider(_published("1.3000")))
    changed = await get_rates_digest(user_id, holds_other_currencies=True, provider=FakeProvider(_published("1.31")))
    lost_a_day = await get_rates_digest(
        user_id, holds_other_currencies=True, provider=FakeProvider({("USD", "CAD"): {day: Decimal("1.30") for day in _WINDOW_DAYS[1:]}})
    )

    assert first is not None
    assert again == first, "the same rates give the same digest"
    assert written_with_more_digits == first, "an equal rate written with more digits is not a change"
    assert changed not in (None, first), "a changed rate moves the digest"
    assert lost_a_day not in (None, first), "a rate that goes missing moves the digest"


async def test_the_digest_asks_for_the_unsettled_window_of_each_recorded_pair(published_valkey, user_id):
    """The provider is asked for the last 7 days of each recorded pair, as the cache treats older days as fixed"""
    await _convert(("USD", "CAD"))
    await _convert(("EUR", "CAD"))
    provider = FakeProvider({**_published("1.3"), **_published("1.5", base="EUR")})

    assert await get_rates_digest(user_id, holds_other_currencies=True, provider=provider) is not None

    assert sorted(provider.calls) == [("EUR", "CAD", _WINDOW_DAYS[-1], _WINDOW_DAYS[0]), ("USD", "CAD", _WINDOW_DAYS[-1], _WINDOW_DAYS[0])]


async def test_the_digest_holds_steady_for_a_user_with_only_their_own_currency(published_valkey, user_id):
    """A user with no recorded pair and no account in another currency gets the same known digest each visit"""
    provider = FakeProvider(_published("1.3"))

    first = await get_rates_digest(user_id, holds_other_currencies=False, provider=provider)
    second = await get_rates_digest(user_id, holds_other_currencies=False, provider=provider)

    assert first is not None
    assert second == first
    assert provider.calls == []


async def test_the_digest_is_unknown_with_no_recorded_pair_for_a_user_holding_other_currencies(published_valkey, user_id):
    """A user whose figures need conversions but whose pairs expired or failed to record can't be compared"""
    provider = FakeProvider(_published("1.3"))

    assert await get_rates_digest(user_id, holds_other_currencies=True, provider=provider) is None
    assert provider.calls == []


async def test_the_digest_holds_steady_for_a_user_whose_conversions_are_all_withheld(published_valkey, user_id):
    """A user holding other currencies whose conversions are withheld records no pair, and gets the fixed digest with no provider call"""
    provider = FakeProvider(_published("1.3"))

    first = await get_rates_digest(user_id, holds_other_currencies=True, withholds_conversion=True, provider=provider)
    second = await get_rates_digest(user_id, holds_other_currencies=True, withholds_conversion=True, provider=provider)

    assert first is not None
    assert second == first
    assert provider.calls == []


async def test_the_digest_is_unknown_when_the_recorded_pairs_cannot_be_read(published_valkey, user_id, monkeypatch):
    """A store that fails while reading the pairs gives an unknown digest, never the empty one"""
    await _convert(("USD", "CAD"))

    async def failed_read(_key, *, min_score):
        """Answer as the store does while it fails or cools down"""
        return None

    monkeypatch.setattr(published_valkey, "get_scored_set", failed_read)

    assert await get_used_pairs(user_id) is None
    assert await get_rates_digest(user_id, holds_other_currencies=False, provider=FakeProvider(_published("1.3"))) is None


async def test_the_digest_moves_once_a_first_pair_is_converted(published_valkey, user_id):
    """Converting a first currency pair moves the digest away from the empty one, even with no rate in the window"""
    empty = await get_rates_digest(user_id, holds_other_currencies=False, provider=FakeProvider(_published("1.3")))

    await _convert(("USD", "CAD"))

    assert await get_rates_digest(user_id, holds_other_currencies=False, provider=FakeProvider(_published("1.3"))) not in (None, empty)
    assert await get_rates_digest(user_id, holds_other_currencies=False, provider=FakeProvider({("USD", "CAD"): {}})) not in (None, empty)


async def test_the_digest_is_unknown_with_no_store(user_id):
    """Without ValKey no pair is recorded and no digest is given, and the provider is never asked"""
    await _convert(("USD", "CAD"))
    provider = FakeProvider(_published("1.3"))

    assert await get_rates_digest(user_id, holds_other_currencies=False, provider=provider) is None
    assert provider.calls == []


async def test_the_digest_is_unknown_when_the_provider_fails(published_valkey, user_id):
    """One pair the provider can't serve leaves the whole digest unknown rather than a partial one"""
    await _convert(("USD", "CAD"))
    await _convert(("EUR", "CAD"))
    provider = FakeProvider(_published("1.3"), errors={("EUR", "CAD"): FxProviderUnavailableError("down")})

    assert await get_rates_digest(user_id, holds_other_currencies=True, provider=provider) is None


async def test_the_digest_is_unknown_when_reading_overruns_its_budget(published_valkey, user_id, monkeypatch):
    """A provider slower than the time budget gives an unknown digest, and its late answer raises nothing"""
    await _convert(("USD", "CAD"))
    monkeypatch.setattr(rates_status, "RATES_STATUS_BUDGET_SECONDS", 0.05)

    assert await get_rates_digest(user_id, holds_other_currencies=True, provider=SlowProvider(_published("1.3"))) is None

    await asyncio.sleep(0.3)


async def test_concurrent_asks_make_one_provider_call_per_pair(published_valkey, user_id):
    """Five requests asking at once for the same pair share one provider call, and all get its digest"""
    await _convert(("USD", "CAD"))
    provider = SlowProvider(_published("1.3"))

    digests = await asyncio.gather(*(get_rates_digest(user_id, holds_other_currencies=True, provider=provider) for _ in range(5)))

    assert len(provider.calls) == 1
    assert digests[0] is not None
    assert set(digests) == {digests[0]}


async def test_a_pair_not_converted_for_30_days_leaves_the_record_while_the_others_stay(published_valkey, user_id, monkeypatch):
    """A read drops the pairs last converted more than 30 days ago, however recently the user converted others"""
    now = [_NOW.timestamp()]
    monkeypatch.setattr(used_pairs, "_now", lambda: now[0])
    await _convert(("USD", "CAD"))
    left_ms = await published_valkey.client.pttl(published_valkey.namespace + used_pairs._key(user_id))
    assert timedelta(days=29) < timedelta(milliseconds=left_ms) <= used_pairs.USED_PAIR_TTL, "the record's key expires 30 days after a record"
    await _convert(("EUR", "CAD"))
    now[0] += timedelta(days=20).total_seconds()
    await _convert(("EUR", "CAD"))
    await _convert(("GBP", "CAD"))

    now[0] += timedelta(days=11).total_seconds()
    assert await get_used_pairs(user_id) == [("EUR", "CAD"), ("GBP", "CAD")], "USD/CAD was last converted 31 days ago"

    now[0] += timedelta(days=20).total_seconds()
    assert await get_used_pairs(user_id) == [], "every pair is past 30 days since its last conversion"


async def test_a_pair_converted_exactly_30_days_ago_is_kept_and_a_second_later_it_is_dropped(published_valkey, user_id, monkeypatch):
    """The cutoff drops only pairs older than 30 days, so the pair stays on its 30th day"""
    now = [_NOW.timestamp()]
    monkeypatch.setattr(used_pairs, "_now", lambda: now[0])
    await _convert(("USD", "CAD"))

    now[0] += used_pairs.USED_PAIR_TTL.total_seconds()
    assert await get_used_pairs(user_id) == [("USD", "CAD")]

    now[0] += 1
    assert await get_used_pairs(user_id) == []


async def test_converter_clones_share_one_pair_record(user_id, monkeypatch):
    """A request's converter and the clones it makes record a pair once between them, before or after the clone is made"""
    recorded: list[tuple[str, str]] = []

    async def record(base: str, quote: str) -> None:
        """Note the pair instead of storing it"""
        recorded.append((base, quote))

    monkeypatch.setattr(converter_module, "record_used_pair", record)
    provider = FakeProvider({**_published("1.3"), **_published("1.5", base="EUR")})
    converter = FxConverter(provider=provider, currency_exponents=_EXPONENTS)
    early_clone = converter.clone()

    await converter.convert_minor_units(100, base="USD", quote="CAD", rate_date=date(2026, 10, 20))
    await early_clone.convert_minor_units(100, base="USD", quote="CAD", rate_date=date(2026, 10, 19))
    await converter.clone().convert_minor_units(100, base="EUR", quote="CAD", rate_date=date(2026, 10, 20))
    await early_clone.convert_minor_units(100, base="EUR", quote="CAD", rate_date=date(2026, 10, 19))

    assert recorded == [("USD", "CAD"), ("EUR", "CAD")]


async def test_a_rate_answered_after_the_budget_still_reaches_the_rate_cache(published_valkey, user_id, monkeypatch):
    """The request that gave up leaves the read running, so the next ask finds the rates cached and asks the provider for nothing"""
    await _convert(("USD", "CAD"))
    monkeypatch.setattr(rates_status, "RATES_STATUS_BUDGET_SECONDS", 0.05)
    gated = GatedProvider(_published("1.3"))

    assert await get_rates_digest(user_id, holds_other_currencies=True, provider=CachedFxRateProvider(gated)) is None
    assert gated.started.is_set()
    gated.release.set()
    await asyncio.gather(*rates_status._in_flight.values())

    later = FakeProvider()
    assert await get_rates_digest(user_id, holds_other_currencies=True, provider=CachedFxRateProvider(later)) is not None
    assert later.calls == []


async def test_a_failing_store_skips_the_pair_and_the_conversion_still_answers(user_id, monkeypatch):
    """A store that errors on the write costs the record of that pair and starts the cooldown, and the figures are still converted"""
    executes: list[str] = []

    class BrokenPipeline:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        def zadd(self, *args, **kwargs):
            pass

        def pexpire(self, *args, **kwargs):
            pass

        def zremrangebyscore(self, *args, **kwargs):
            pass

        def zrange(self, *args, **kwargs):
            pass

        async def execute(self):
            executes.append("execute")
            raise RuntimeError("not a ValKey error")

    class BrokenClient:
        def pipeline(self, transaction):
            return BrokenPipeline()

    store = ValkeyStore(BrokenClient(), namespace="t:")
    monkeypatch.setattr(used_pairs, "get_valkey", lambda: store)

    await _convert(("USD", "CAD"))
    await _convert(("EUR", "CAD"))

    assert executes == ["execute"], "the first failure starts the cooldown, so the second pair never reaches the store"
    assert await get_used_pairs(user_id) is None, "a read during the cooldown is unknown, not empty"
    assert executes == ["execute"], "the read waits out the cooldown too"
