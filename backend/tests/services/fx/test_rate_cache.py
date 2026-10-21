"""Exchange rates cached in ValKey across requests

These run against the real test ValKey, so what is checked is what it keeps and for how long
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import httpx
import pytest

from app.services.fx import FrankfurterProvider, FxProviderUnavailableError, FxRateNotFoundError, FxRateRejectedError, rate_cache
from app.services.fx.lookup_budget import FxLookupBudget, use_lookup_budget
from app.services.fx.rate_cache import CachedFxRateProvider
from app.valkey_store import ValkeyEntry, ValkeyStore, use_valkey
from tests.services.fx.fakes import FakeProvider
from tests.valkey_fakes import ANSWER, EMPTY, OUT_OF_MEMORY, fake_valkey_server

# The moment the cache believes it is, so which dates count as settled does not depend on the day the
# suite runs. A date is settled when it is at least 7 days before this day
_NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
_TODAY = _NOW.date()

# Well before the settled cutoff, so ordinary tests never sit near the boundary
_DAY_1 = date(2026, 3, 10)
_DAY_2 = date(2026, 3, 11)
_DAY_3 = date(2026, 3, 12)
_DAY_4 = date(2026, 3, 13)
_DAY_5 = date(2026, 3, 14)

_RATE = Decimal("1.37")

_FIVE_MINUTES_MS = 5 * 60 * 1000
_ONE_HOUR_MS = 60 * 60 * 1000
_ONE_WEEK_MS = 7 * 24 * _ONE_HOUR_MS
_HALF_A_YEAR_MS = 180 * 24 * _ONE_HOUR_MS

# How far below its full lifetime a freshly stored entry may read, for the time the test itself took
_LIFETIME_TOLERANCE_MS = 60 * 1000


@pytest.fixture(autouse=True)
def fixed_now(freeze_now):
    """Make the cache read the moment above as now"""
    freeze_now(rate_cache, _NOW)


def _cached(provider) -> CachedFxRateProvider:
    """Wrap a provider, as the converter does by default"""
    return CachedFxRateProvider(provider)


async def _left_ms(store: ValkeyStore, lookup: str, rate_date: date) -> int:
    """Return how long ValKey will still hold the entry for a USD to CAD date, in milliseconds"""
    return await store.client.pttl(store.namespace + rate_cache._key(lookup, "USD", "CAD", rate_date))


async def test_a_rate_is_fetched_once_and_a_cache_hit_spends_none_of_the_request_budget(published_valkey):
    """The second lookup of a date makes no outbound call and costs the request none of its provider time

    Uses the real Frankfurter provider over a mock network, since it is what charges the budget
    """
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"date": "2026-03-10", "base": "USD", "quote": "CAD", "rate": "1.37"})

    budget = FxLookupBudget()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _cached(FrankfurterProvider(url="https://fx.example.test/v2", client=client))
        with use_lookup_budget(budget):
            assert await provider.get_rate("USD", "CAD", _DAY_1) == _RATE
            spent_by_the_fetch = budget.spent
            assert spent_by_the_fetch > 0
            assert await provider.get_rate("usd", "cad", _DAY_1) == _RATE

    assert calls == 1
    assert budget.spent == spent_by_the_fetch


async def test_without_a_published_store_every_lookup_asks_the_provider():
    """With no cache the provider is asked each time, as the server did before there was one"""
    provider = FakeProvider(rates={("USD", "CAD", _DAY_1): _RATE})

    await _cached(provider).get_rate("USD", "CAD", _DAY_1)
    await _cached(provider).get_rate("USD", "CAD", _DAY_1)

    assert provider.calls == [("USD", "CAD", _DAY_1)] * 2


async def test_a_range_fetched_rate_never_answers_a_single_date_lookup_and_the_reverse(published_valkey):
    """Frankfurter answers a date differently in each kind of lookup, so each is cached under its own key"""
    provider = FakeProvider(
        rates={("USD", "CAD", _DAY_1): Decimal("1.30")},
        rate_ranges={("USD", "CAD", _DAY_1, _DAY_1): {_DAY_1: Decimal("1.40")}},
    )
    cached = _cached(provider)

    assert await cached.get_rates("USD", "CAD", _DAY_1, _DAY_1) == {_DAY_1: Decimal("1.40")}
    assert await cached.get_rate("USD", "CAD", _DAY_1) == Decimal("1.30")

    assert await cached.get_rates("USD", "CAD", _DAY_1, _DAY_1) == {_DAY_1: Decimal("1.40")}
    assert await cached.get_rate("USD", "CAD", _DAY_1) == Decimal("1.30")
    assert len(provider.calls) == 1
    assert len(provider.range_calls) == 1


async def test_a_range_asks_for_one_span_from_its_first_to_its_last_uncached_date(published_valkey):
    """With the ends of a range cached, only the dates between them are fetched, in one call"""
    provider = FakeProvider(
        rate_ranges={
            ("USD", "CAD", _DAY_1, _DAY_1): {_DAY_1: Decimal("1.31")},
            ("USD", "CAD", _DAY_5, _DAY_5): {_DAY_5: Decimal("1.35")},
            ("USD", "CAD", _DAY_2, _DAY_4): {_DAY_2: Decimal("1.32"), _DAY_3: Decimal("1.33"), _DAY_4: Decimal("1.34")},
        },
    )
    cached = _cached(provider)
    await cached.get_rates("USD", "CAD", _DAY_1, _DAY_1)
    await cached.get_rates("USD", "CAD", _DAY_5, _DAY_5)

    rates = await cached.get_rates("USD", "CAD", _DAY_1, _DAY_5)

    assert provider.range_calls[2:] == [("USD", "CAD", _DAY_2, _DAY_4)]
    assert rates == {
        _DAY_1: Decimal("1.31"),
        _DAY_2: Decimal("1.32"),
        _DAY_3: Decimal("1.33"),
        _DAY_4: Decimal("1.34"),
        _DAY_5: Decimal("1.35"),
    }


async def test_a_missing_rate_is_remembered_and_not_asked_for_again(published_valkey):
    """A date the provider has no rate for is answered from the cache the second time, for both lookups"""
    provider = FakeProvider(
        errors={("USD", "CAD", _DAY_1): FxRateNotFoundError()},
        rate_ranges={("USD", "CAD", _DAY_1, _DAY_2): {_DAY_2: _RATE}},
    )
    cached = _cached(provider)

    for _ in range(2):
        with pytest.raises(FxRateNotFoundError):
            await cached.get_rate("USD", "CAD", _DAY_1)
        assert await cached.get_rates("USD", "CAD", _DAY_1, _DAY_2) == {_DAY_2: _RATE}

    assert len(provider.calls) == 1
    assert len(provider.range_calls) == 1


async def test_a_rate_in_the_middle_of_a_span_survives_the_provider_leaving_it_out(published_valkey):
    """A stored rate is never replaced by a later answer that has none for its date"""
    provider = FakeProvider(
        rate_ranges={
            ("USD", "CAD", _DAY_2, _DAY_2): {_DAY_2: Decimal("1.32")},
            ("USD", "CAD", _DAY_1, _DAY_3): {_DAY_1: Decimal("1.31"), _DAY_3: Decimal("1.33")},
        },
    )
    cached = _cached(provider)
    await cached.get_rates("USD", "CAD", _DAY_2, _DAY_2)

    await cached.get_rates("USD", "CAD", _DAY_1, _DAY_3)

    assert await cached.get_rates("USD", "CAD", _DAY_2, _DAY_2) == {_DAY_2: Decimal("1.32")}
    assert len(provider.range_calls) == 2


@pytest.mark.parametrize("lookup", ["rate", "rates"])
async def test_a_provider_outage_is_not_cached(published_valkey, lookup):
    """A lookup that failed as unavailable is asked again next time instead of being remembered as missing"""
    provider = FakeProvider(
        errors={("USD", "CAD", _DAY_1): FxProviderUnavailableError()},
        range_errors={("USD", "CAD", _DAY_1, _DAY_1): FxProviderUnavailableError()},
    )
    cached = _cached(provider)

    async def lookup_once():
        if lookup == "rate":
            return await cached.get_rate("USD", "CAD", _DAY_1)
        return await cached.get_rates("USD", "CAD", _DAY_1, _DAY_1)

    with pytest.raises(FxProviderUnavailableError):
        await lookup_once()

    provider.errors.clear()
    provider.range_errors.clear()
    provider.rates[("USD", "CAD", _DAY_1)] = _RATE
    provider.rate_ranges[("USD", "CAD", _DAY_1, _DAY_1)] = {_DAY_1: _RATE}

    assert await lookup_once() == (_RATE if lookup == "rate" else {_DAY_1: _RATE})
    assert len(provider.calls) + len(provider.range_calls) == 2


async def test_an_outage_on_part_of_a_range_still_fails_the_range_with_the_rest_cached(published_valkey):
    """The panel degrades to its unavailable status as it did before the cache, even if part of the range is stored"""
    provider = FakeProvider(
        rate_ranges={("USD", "CAD", _DAY_1, _DAY_1): {_DAY_1: _RATE}},
        range_errors={("USD", "CAD", _DAY_2, _DAY_2): FxProviderUnavailableError()},
    )
    cached = _cached(provider)
    await cached.get_rates("USD", "CAD", _DAY_1, _DAY_1)

    with pytest.raises(FxProviderUnavailableError):
        await cached.get_rates("USD", "CAD", _DAY_1, _DAY_2)


@pytest.mark.parametrize("lookup", ["rate", "rates"])
async def test_a_rejected_request_is_not_remembered_as_a_missing_rate(published_valkey, lookup):
    """A client error other than 404 says nothing about the rate, so the provider is asked again next time"""
    provider = FakeProvider(
        errors={("USD", "CAD", _DAY_1): FxRateRejectedError()},
        range_errors={("USD", "CAD", _DAY_1, _DAY_1): FxRateRejectedError()},
    )
    cached = _cached(provider)

    for _ in range(2):
        with pytest.raises(FxRateRejectedError):
            if lookup == "rate":
                await cached.get_rate("USD", "CAD", _DAY_1)
            else:
                await cached.get_rates("USD", "CAD", _DAY_1, _DAY_1)

    assert len(provider.calls) + len(provider.range_calls) == 2


_LIFETIME_CASES = [
    (6, False, _ONE_HOUR_MS),
    (7, False, _HALF_A_YEAR_MS),
    (-5, False, _ONE_HOUR_MS),
    (0, False, _ONE_HOUR_MS),
    (6, True, _FIVE_MINUTES_MS),
    (7, True, _ONE_WEEK_MS),
    (-5, True, _FIVE_MINUTES_MS),
]
_LIFETIME_IDS = ["recent-rate", "settled-rate", "future-rate", "today-rate", "recent-missing", "settled-missing", "future-missing"]


@pytest.mark.parametrize("lookup", [rate_cache.DATE_LOOKUP, rate_cache.RANGE_LOOKUP], ids=["date", "range"])
@pytest.mark.parametrize(("days_before_today", "is_missing", "expected_ms"), _LIFETIME_CASES, ids=_LIFETIME_IDS)
async def test_each_answer_lives_as_long_as_its_date_is_settled_and_whether_it_is_missing(
    published_valkey, lookup, days_before_today, is_missing, expected_ms
):
    """A date is settled from 7 days before the day it was fetched, and the answer's lifetime follows

    A missing answer is the provider's 404 in both kinds of lookup, so it is remembered and the
    second lookup asks nothing. Reads the lifetime ValKey holds, so a wrong unit or a swapped pair
    of durations shows up
    """
    rate_date = _TODAY - timedelta(days=days_before_today)
    provider = FakeProvider(
        rates={} if is_missing else {("USD", "CAD", rate_date): _RATE},
        rate_ranges={} if is_missing else {("USD", "CAD", rate_date, rate_date): {rate_date: _RATE}},
        errors={("USD", "CAD", rate_date): FxRateNotFoundError()} if is_missing else {},
        range_errors={("USD", "CAD", rate_date, rate_date): FxRateNotFoundError()} if is_missing else {},
    )
    cached = _cached(provider)

    async def lookup_once() -> None:
        if lookup == rate_cache.RANGE_LOOKUP:
            assert await cached.get_rates("USD", "CAD", rate_date, rate_date) == ({} if is_missing else {rate_date: _RATE})
            return
        try:
            await cached.get_rate("USD", "CAD", rate_date)
        except FxRateNotFoundError:
            assert is_missing

    await lookup_once()
    left = await _left_ms(published_valkey, lookup, rate_date)
    await lookup_once()

    assert expected_ms - _LIFETIME_TOLERANCE_MS < left <= expected_ms
    assert len(provider.calls) + len(provider.range_calls) == 1


@pytest.mark.parametrize("rate", [Decimal("1.2345678901234567E-7"), Decimal("0.000123456789012345678901234567"), Decimal("1234567.5")])
async def test_a_rate_comes_back_from_the_cache_exactly_as_the_provider_gave_it(published_valkey, rate):
    """No float or rounding sits between the provider and a total, so cached totals match uncached ones"""
    provider = FakeProvider(rates={("USD", "CAD", _DAY_1): rate})
    cached = _cached(provider)
    await cached.get_rate("USD", "CAD", _DAY_1)

    from_cache = await cached.get_rate("USD", "CAD", _DAY_1)

    assert str(from_cache) == str(rate)
    assert len(provider.calls) == 1


@pytest.mark.parametrize("stored", [b"not a number", b"NaN", b"Infinity", b"0", b"-1.5", b"\xff\xfe"])
async def test_an_entry_that_is_no_valid_rate_is_fetched_again_and_repaired(published_valkey, stored):
    """A corrupt cached value, zero or a negative rate never reaches an amount: the provider is asked and the entry fixed"""
    key = rate_cache._key(rate_cache.DATE_LOOKUP, "USD", "CAD", _DAY_1)
    await published_valkey.set_many([ValkeyEntry(key, stored, timedelta(hours=1))])
    provider = FakeProvider(rates={("USD", "CAD", _DAY_1): _RATE})
    cached = _cached(provider)

    assert await cached.get_rate("USD", "CAD", _DAY_1) == _RATE
    assert await cached.get_rate("USD", "CAD", _DAY_1) == _RATE

    assert len(provider.calls) == 1


async def test_a_refused_write_still_returns_the_providers_rate_and_skips_valkey_after():
    """A ValKey that answers reads but refuses writes, as one out of memory or read-only does, costs only the cache"""
    async with fake_valkey_server({b"MGET": EMPTY, b"SET": OUT_OF_MEMORY}) as server:
        store = ValkeyStore.from_url(server.url, namespace="t:")
        provider = FakeProvider(rates={("USD", "CAD", _DAY_1): _RATE})
        try:
            async with use_valkey(store):
                cached = _cached(provider)
                assert await cached.get_rate("USD", "CAD", _DAY_1) == _RATE
                assert await cached.get_rate("USD", "CAD", _DAY_1) == _RATE
        finally:
            await store.aclose()

    sent = [command[0].upper() for command in server.data_commands]
    assert sent == [b"MGET", b"SET"]
    assert len(provider.calls) == 2


async def test_an_unreachable_valkey_leaves_every_lookup_to_the_provider():
    """A configured but dead cache costs nothing but the cache: rates still come from the provider"""
    async with fake_valkey_server(ANSWER) as server:
        dead_url = server.url

    dead = ValkeyStore.from_url(dead_url, namespace="t:")
    provider = FakeProvider(
        rates={("USD", "CAD", _DAY_1): _RATE},
        rate_ranges={("USD", "CAD", _DAY_1, _DAY_2): {_DAY_1: _RATE, _DAY_2: _RATE}},
    )
    try:
        async with use_valkey(dead):
            cached = _cached(provider)
            assert await cached.get_rate("USD", "CAD", _DAY_1) == _RATE
            assert await cached.get_rates("USD", "CAD", _DAY_1, _DAY_2) == {_DAY_1: _RATE, _DAY_2: _RATE}
    finally:
        await dead.aclose()
