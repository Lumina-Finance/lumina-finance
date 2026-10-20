import asyncio
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.schemas.fx import FxRateIssue, FxStatus
from app.services.fx import (
    FrankfurterProvider,
    FxConverter,
    FxProviderUnavailableError,
    FxRateNotFoundError,
    FxRateRejectedError,
    FxRateResponseError,
    convert_minor_units,
)
from app.services.fx.frankfurter_provider import DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS
from app.services.fx.lookup_budget import FxLookupBudget, use_lookup_budget
from tests.services.fx.fakes import FakeProvider


async def test_converter_reuses_rate_within_one_request():
    """Repeated pair/date conversions fetch the provider rate once."""
    rate_date = date(2026, 5, 30)
    provider = FakeProvider({("USD", "CAD", rate_date): Decimal("1.375")})
    converter = FxConverter(
        provider=provider,
        currency_exponents={"USD": 2, "CAD": 2},
    )

    first = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=rate_date)
    second = await converter.convert_minor_units(20_00, base="USD", quote="CAD", rate_date=rate_date)

    assert first == 13_75
    assert second == 27_50
    assert provider.calls == [("USD", "CAD", rate_date)]
    assert converter.get_status().state == "complete"


async def test_converter_reports_missing_pair_once():
    """Missing rates are memoized as failures and reported in detail."""
    rate_date = date(2026, 5, 30)
    provider = FakeProvider(errors={("ABC", "CAD", rate_date): FxRateNotFoundError()})
    converter = FxConverter(
        provider=provider,
        currency_exponents={"ABC": 2, "CAD": 2},
    )

    first = await converter.convert_minor_units(10_00, base="ABC", quote="CAD", rate_date=rate_date)
    second = await converter.convert_minor_units(20_00, base="ABC", quote="CAD", rate_date=rate_date)

    assert first is None
    assert second is None
    assert provider.calls == [("ABC", "CAD", rate_date)]
    assert converter.get_status() == FxStatus(
        state="incomplete",
        missing_pairs=[FxRateIssue(base="ABC", quote="CAD")],
    )


async def test_converter_reports_provider_unavailable_when_all_fx_fails():
    """Provider failures mark the whole FX calculation unavailable when nothing converts."""
    rate_date = date(2026, 5, 30)
    provider = FakeProvider(errors={("USD", "CAD", rate_date): FxProviderUnavailableError()})
    converter = FxConverter(
        provider=provider,
        currency_exponents={"USD": 2, "CAD": 2},
    )

    converted = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=rate_date)

    assert converted is None
    assert converter.get_status() == FxStatus(
        state="unavailable",
        missing_pairs=[FxRateIssue(base="USD", quote="CAD")],
    )


async def test_converter_prefetches_range_rates_once():
    """Prefetched date-window rates avoid per-day provider lookups."""
    start_date = date(2026, 5, 29)
    end_date = date(2026, 5, 30)
    provider = FakeProvider(
        rate_ranges={
            ("USD", "CAD", start_date, end_date): {
                start_date: Decimal("1.37"),
                end_date: Decimal("1.375"),
            },
        },
    )
    converter = FxConverter(
        provider=provider,
        currency_exponents={"USD": 2, "CAD": 2},
    )

    await converter.prefetch_rates(base="USD", quote="CAD", start_date=start_date, end_date=end_date)
    first = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=start_date)
    second = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=end_date)

    assert first == 13_70
    assert second == 13_75
    assert provider.range_calls == [("USD", "CAD", start_date, end_date)]
    assert provider.calls == []


async def test_converter_reports_missing_prefetched_dates_when_used():
    """Missing dates from a prefetched range are reported only when conversion needs them."""
    start_date = date(2026, 5, 29)
    end_date = date(2026, 5, 30)
    provider = FakeProvider(
        rate_ranges={
            ("USD", "CAD", start_date, end_date): {
                end_date: Decimal("1.375"),
            },
        },
    )
    converter = FxConverter(
        provider=provider,
        currency_exponents={"USD": 2, "CAD": 2},
    )

    await converter.prefetch_rates(base="USD", quote="CAD", start_date=start_date, end_date=end_date)
    unused_missing = await converter.convert_minor_units(0, base="USD", quote="CAD", rate_date=start_date)
    converted = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=end_date)

    assert unused_missing == 0
    assert converted == 13_75
    assert converter.get_status() == FxStatus(state="complete")


@pytest.mark.parametrize("lookup", ["rate", "rates"])
async def test_converter_reports_a_rejected_lookup_as_a_missing_pair(lookup):
    """A request the provider refused leaves the amount out as a missing pair, never failing the panel"""
    rate_date = date(2026, 5, 30)
    provider = FakeProvider(
        errors={("USD", "CAD", rate_date): FxRateRejectedError()},
        range_errors={("USD", "CAD", rate_date, rate_date): FxRateRejectedError()},
    )
    converter = FxConverter(
        provider=provider,
        currency_exponents={"USD": 2, "CAD": 2},
    )

    if lookup == "rates":
        await converter.prefetch_rates(base="USD", quote="CAD", start_date=rate_date, end_date=rate_date)
    converted = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=rate_date)

    assert converted is None
    assert len(provider.calls) + len(provider.range_calls) == 1
    assert converter.get_status() == FxStatus(
        state="incomplete",
        missing_pairs=[FxRateIssue(base="USD", quote="CAD")],
    )


def test_convert_minor_units_handles_currency_exponents_and_rounding():
    """Minor-unit conversion respects source and target currency exponents."""
    assert convert_minor_units(123, rate=Decimal("0.0091"), base_exponent=0, quote_exponent=2) == 112


async def test_frankfurter_provider_uses_configured_url_and_date():
    """FrankfurterProvider calls the configured single-pair endpoint."""
    seen_url = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_url
        seen_url = request.url
        return httpx.Response(200, json={"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 1.375})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rate = await FrankfurterProvider(url="https://fx.example.test/v2/", client=client).get_rate(
            "usd",
            "cad",
            date(2026, 5, 30),
        )

    assert rate == Decimal("1.375")
    assert seen_url is not None
    assert seen_url.scheme == "https"
    assert seen_url.host == "fx.example.test"
    assert seen_url.path == "/v2/rate/USD/CAD"
    assert seen_url.params["date"] == "2026-05-30"


async def test_frankfurter_provider_uses_configured_url_for_rate_range():
    """FrankfurterProvider calls the configured filtered time-series endpoint."""
    seen_url = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_url
        seen_url = request.url
        return httpx.Response(
            200,
            json=[
                {"date": "2026-05-29", "base": "USD", "quote": "CAD", "rate": 1.37},
                {"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 1.375},
            ],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rates = await FrankfurterProvider(url="https://fx.example.test/v2/", client=client).get_rates(
            "usd",
            "cad",
            date(2026, 5, 29),
            date(2026, 5, 30),
        )

    assert rates == {
        date(2026, 5, 29): Decimal("1.37"),
        date(2026, 5, 30): Decimal("1.375"),
    }
    assert seen_url is not None
    assert seen_url.scheme == "https"
    assert seen_url.host == "fx.example.test"
    assert seen_url.path == "/v2/rates"
    assert seen_url.params["base"] == "USD"
    assert seen_url.params["quotes"] == "CAD"
    assert seen_url.params["from"] == "2026-05-29"
    assert seen_url.params["to"] == "2026-05-30"


async def test_frankfurter_provider_retries_single_rate_failure(monkeypatch):
    """FrankfurterProvider retries a failed single-rate lookup before returning a successful rate"""
    calls = 0
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        """Record retry delays without waiting"""
        sleep_calls.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 1.375})

    monkeypatch.setattr("app.services.fx.frankfurter_provider.asyncio.sleep", fake_sleep)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rate = await FrankfurterProvider(url="https://fx.example.test/v2/", client=client).get_rate(
            "USD",
            "CAD",
            date(2026, 5, 30),
        )

    assert rate == Decimal("1.375")
    assert calls == 2
    assert sleep_calls == [DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS]


async def test_frankfurter_provider_retries_rate_range_failure(monkeypatch):
    """FrankfurterProvider retries failed range lookups before returning successful rates"""
    calls = 0
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        """Record retry delays without waiting"""
        sleep_calls.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json=[
                {"date": "2026-05-29", "base": "USD", "quote": "CAD", "rate": 1.37},
                {"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 1.375},
            ],
        )

    monkeypatch.setattr("app.services.fx.frankfurter_provider.asyncio.sleep", fake_sleep)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rates = await FrankfurterProvider(url="https://fx.example.test/v2/", client=client).get_rates(
            "USD",
            "CAD",
            date(2026, 5, 29),
            date(2026, 5, 30),
        )

    assert rates == {
        date(2026, 5, 29): Decimal("1.37"),
        date(2026, 5, 30): Decimal("1.375"),
    }
    assert calls == 3
    assert sleep_calls == [
        DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS,
        DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS,
    ]


async def test_frankfurter_provider_surfaces_final_lookup_error_after_three_attempts(monkeypatch):
    """FrankfurterProvider surfaces the existing FX error after all retry attempts fail"""
    calls = 0
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float) -> None:
        """Record retry delays without waiting"""
        sleep_calls.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503)

    monkeypatch.setattr("app.services.fx.frankfurter_provider.asyncio.sleep", fake_sleep)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FxProviderUnavailableError):
            await FrankfurterProvider(url="https://fx.example.test/v2/", client=client).get_rate(
                "USD",
                "CAD",
                date(2026, 5, 30),
            )

    assert calls == 3
    assert sleep_calls == [
        DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS,
        DEFAULT_FX_PROVIDER_RETRY_DELAY_SECONDS,
    ]


async def test_frankfurter_provider_rejects_invalid_payload():
    """FrankfurterProvider does not accept malformed rate payloads."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"date": "2026-05-30", "base": "EUR", "quote": "CAD", "rate": 1.375})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FxRateResponseError):
            await FrankfurterProvider(client=client, retry_delay_seconds=0).get_rate("USD", "CAD", date(2026, 5, 30))


async def test_frankfurter_provider_rejects_invalid_rate():
    """FrankfurterProvider requires a finite positive rate."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 0})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FxRateResponseError):
            await FrankfurterProvider(client=client, retry_delay_seconds=0).get_rate("USD", "CAD", date(2026, 5, 30))


@pytest.mark.parametrize("lookup", ["rate", "rates"])
async def test_frankfurter_provider_asks_once_for_an_unknown_pair(lookup):
    """An unknown currency is a final answer, so one bad pair costs one request, not three"""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(422, json={"status": 422, "message": "invalid currency: ABC"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = FrankfurterProvider(url="https://fx.example.test/v2/", client=client, retry_delay_seconds=0)
        with pytest.raises(FxRateNotFoundError):
            if lookup == "rate":
                await provider.get_rate("ABC", "CAD", date(2026, 5, 30))
            else:
                await provider.get_rates("ABC", "CAD", date(2026, 5, 29), date(2026, 5, 30))

    assert calls == 1


@pytest.mark.parametrize("lookup", ["rate", "rates"])
@pytest.mark.parametrize("status_code", [400, 403, 422])
async def test_frankfurter_provider_tells_a_rejected_request_from_a_missing_rate(lookup, status_code):
    """Only a 404 is the provider saying it has no rate. Any other client error is a rejection

    Callers still read a rejection as a missing rate, since it is a kind of one, but the cache must
    not keep it as the provider's answer, because a changed API or a refused request says nothing
    about the rate
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"message": "rejected"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = FrankfurterProvider(url="https://fx.example.test/v2/", client=client, retry_delay_seconds=0)
        with pytest.raises(FxRateRejectedError):
            if lookup == "rate":
                await provider.get_rate("USD", "CAD", date(2026, 5, 30))
            else:
                await provider.get_rates("USD", "CAD", date(2026, 5, 29), date(2026, 5, 30))


@pytest.mark.parametrize("lookup", ["rate", "rates"])
async def test_frankfurter_provider_reports_a_404_as_a_plain_missing_rate(lookup):
    """A 404 raises the missing-rate error itself, not the rejection that subclasses it"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = FrankfurterProvider(url="https://fx.example.test/v2/", client=client, retry_delay_seconds=0)
        with pytest.raises(FxRateNotFoundError) as raised:
            if lookup == "rate":
                await provider.get_rate("USD", "CAD", date(2026, 5, 30))
            else:
                await provider.get_rates("USD", "CAD", date(2026, 5, 29), date(2026, 5, 30))

    assert type(raised.value) is FxRateNotFoundError


async def test_frankfurter_provider_treats_rate_limiting_as_unavailable():
    """A rate-limited lookup is retried and then reported unavailable, never as a missing rate"""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FxProviderUnavailableError):
            await FrankfurterProvider(client=client, retry_delay_seconds=0).get_rate("USD", "CAD", date(2026, 5, 30))

    assert calls == 3


async def test_frankfurter_provider_stops_retrying_once_the_request_budget_is_spent(monkeypatch):
    """Attempts and pauses draw on the request's budget, and each attempt may only take what is left"""
    clock = 0.0
    attempt_timeouts: list[float] = []

    def fake_monotonic() -> float:
        """Read the test's clock"""
        return clock

    async def fake_sleep(delay: float) -> None:
        """Pause without waiting"""

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal clock
        attempt_timeouts.append(request.extensions["timeout"]["read"])
        clock += 2.0
        return httpx.Response(503)

    monkeypatch.setattr("app.services.fx.frankfurter_provider.monotonic", fake_monotonic)
    monkeypatch.setattr("app.services.fx.frankfurter_provider.asyncio.sleep", fake_sleep)
    budget = FxLookupBudget(seconds=5.0)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with use_lookup_budget(budget), pytest.raises(FxProviderUnavailableError):
            await FrankfurterProvider(client=client).get_rate("USD", "CAD", date(2026, 5, 30))

    # 2 s, a 0.5 s pause, then 2 s of the 2.5 s left, leaving no room for another pause and try
    assert attempt_timeouts == [5.0, 2.5]
    assert budget.spent == 4.5


async def test_frankfurter_provider_makes_no_request_once_the_budget_is_spent():
    """A lookup after the request's budget is spent fails as unavailable without calling the provider"""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 1.375})

    budget = FxLookupBudget()
    budget.charge(budget.seconds)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with use_lookup_budget(budget), pytest.raises(FxProviderUnavailableError):
            await FrankfurterProvider(client=client).get_rate("USD", "CAD", date(2026, 5, 30))

    assert calls == 0


async def test_frankfurter_provider_gives_up_on_an_answer_slower_than_the_attempt_deadline():
    """An answer still arriving when the attempt's time is up fails as unavailable rather than arriving late"""

    async def handler(request: httpx.Request) -> httpx.Response:
        # The mock transport ignores httpx's own timeouts, as a slowly trickling answer can
        await asyncio.sleep(0.5)
        return httpx.Response(200, json={"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 1.375})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = FrankfurterProvider(client=client, timeout=0.05, retry_attempts=1)
        with pytest.raises(FxProviderUnavailableError):
            await provider.get_rate("USD", "CAD", date(2026, 5, 30))
