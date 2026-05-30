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
    FxRateResponseError,
    convert_minor_units,
)


class _FakeProvider:
    """Small test double for FxRateProvider.

    Converter tests should not hit Frankfurter or mock HTTP details. This fake lets
    each test predeclare rates/errors and then assert how often the provider was used.
    """

    def __init__(
        self,
        rates: dict[tuple[str, str, date], Decimal] | None = None,
        rate_ranges: dict[tuple[str, str, date, date], dict[date, Decimal]] | None = None,
        errors: dict[tuple[str, str, date], Exception] | None = None,
        range_errors: dict[tuple[str, str, date, date], Exception] | None = None,
    ):
        # Success maps are keyed by the exact provider call arguments.
        self.rates = rates or {}
        self.rate_ranges = rate_ranges or {}

        # Error maps simulate missing provider data and endpoint failures.
        self.errors = errors or {}
        self.range_errors = range_errors or {}

        # Call logs make memoization/prefetch behavior explicit in assertions.
        self.calls: list[tuple[str, str, date]] = []
        self.range_calls: list[tuple[str, str, date, date]] = []

    async def get_rate(self, base: str, quote: str, rate_date: date) -> Decimal:
        """Return a fake FX rate or raise the configured error."""
        key = (base, quote, rate_date)
        self.calls.append(key)
        if key in self.errors:
            raise self.errors[key]
        return self.rates[key]

    async def get_rates(self, base: str, quote: str, start_date: date, end_date: date) -> dict[date, Decimal]:
        """Return fake FX rates for a date range or raise the configured error."""
        key = (base, quote, start_date, end_date)
        self.range_calls.append(key)
        if key in self.range_errors:
            raise self.range_errors[key]
        return self.rate_ranges[key]


async def test_converter_reuses_rate_within_one_request():
    """Repeated pair/date conversions fetch the provider rate once."""
    rate_date = date(2026, 5, 30)
    provider = _FakeProvider({("USD", "CAD", rate_date): Decimal("1.375")})
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
    provider = _FakeProvider(errors={("ABC", "CAD", rate_date): FxRateNotFoundError()})
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
    provider = _FakeProvider(errors={("USD", "CAD", rate_date): FxProviderUnavailableError()})
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


async def test_converter_reports_incomplete_when_some_fx_succeeds():
    """Mixed success and missing rates keep successful conversions and report incomplete FX."""
    rate_date = date(2026, 5, 30)
    provider = _FakeProvider(
        rates={("USD", "CAD", rate_date): Decimal("1.375")},
        errors={("ABC", "CAD", rate_date): FxRateNotFoundError()},
    )
    converter = FxConverter(
        provider=provider,
        currency_exponents={"USD": 2, "ABC": 2, "CAD": 2},
    )

    converted = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=rate_date)
    missing = await converter.convert_minor_units(10_00, base="ABC", quote="CAD", rate_date=rate_date)

    assert converted == 13_75
    assert missing is None
    assert converter.get_status() == FxStatus(
        state="incomplete",
        missing_pairs=[FxRateIssue(base="ABC", quote="CAD")],
    )


async def test_converter_prefetches_range_rates_once():
    """Prefetched date-window rates avoid per-day provider lookups."""
    start_date = date(2026, 5, 29)
    end_date = date(2026, 5, 30)
    provider = _FakeProvider(
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
    provider = _FakeProvider(
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


async def test_converter_reports_unavailable_prefetched_range_when_used():
    """Provider failures from prefetching are reported when a conversion needs that date."""
    start_date = date(2026, 5, 29)
    end_date = date(2026, 5, 30)
    provider = _FakeProvider(
        range_errors={("USD", "CAD", start_date, end_date): FxProviderUnavailableError()},
    )
    converter = FxConverter(
        provider=provider,
        currency_exponents={"USD": 2, "CAD": 2},
    )

    await converter.prefetch_rates(base="USD", quote="CAD", start_date=start_date, end_date=end_date)
    converted = await converter.convert_minor_units(10_00, base="USD", quote="CAD", rate_date=end_date)

    assert converted is None
    assert converter.get_status() == FxStatus(
        state="unavailable",
        missing_pairs=[FxRateIssue(base="USD", quote="CAD")],
    )


def test_convert_minor_units_handles_currency_exponents_and_rounding():
    """Minor-unit conversion respects source and target currency exponents."""
    assert convert_minor_units(123, rate=Decimal("0.0091"), base_exponent=0, quote_exponent=2) == 112


async def test_frankfurter_provider_uses_configured_base_url_and_date():
    """FrankfurterProvider calls the v2 single-pair endpoint."""
    seen_url = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_url
        seen_url = request.url
        return httpx.Response(200, json={"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 1.375})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rate = await FrankfurterProvider(base_url="https://fx.example.test/", client=client).get_rate(
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


async def test_frankfurter_provider_uses_configured_base_url_for_rate_range():
    """FrankfurterProvider calls the v2 filtered time-series endpoint."""
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
        rates = await FrankfurterProvider(base_url="https://fx.example.test/", client=client).get_rates(
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


async def test_frankfurter_provider_rejects_invalid_payload():
    """FrankfurterProvider does not accept malformed rate payloads."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"date": "2026-05-30", "base": "EUR", "quote": "CAD", "rate": 1.375})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FxRateResponseError):
            await FrankfurterProvider(client=client).get_rate("USD", "CAD", date(2026, 5, 30))


async def test_frankfurter_provider_rejects_invalid_rate():
    """FrankfurterProvider requires a finite positive rate."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"date": "2026-05-30", "base": "USD", "quote": "CAD", "rate": 0})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FxRateResponseError):
            await FrankfurterProvider(client=client).get_rate("USD", "CAD", date(2026, 5, 30))
