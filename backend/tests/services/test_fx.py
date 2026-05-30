from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services.fx import (
    FrankfurterProvider,
    FxConverter,
    FxProviderUnavailableError,
    FxRateIssue,
    FxRateNotFoundError,
    FxRateResponseError,
    FxStatus,
    convert_minor_units,
)


class _FakeProvider:
    def __init__(
        self,
        rates: dict[tuple[str, str, date], Decimal] | None = None,
        errors: dict[tuple[str, str, date], Exception] | None = None,
    ):
        self.rates = rates or {}
        self.errors = errors or {}
        self.calls: list[tuple[str, str, date]] = []

    async def get_rate(self, base: str, quote: str, rate_date: date) -> Decimal:
        """Return a fake FX rate or raise the configured error."""
        key = (base, quote, rate_date)
        self.calls.append(key)
        if key in self.errors:
            raise self.errors[key]
        return self.rates[key]


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
        missing_pairs=[FxRateIssue(base="ABC", quote="CAD", date=rate_date, reason="rate_not_found")],
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
        missing_pairs=[FxRateIssue(base="USD", quote="CAD", date=rate_date, reason="provider_unavailable")],
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
    assert converter.get_status().state == "incomplete"
    assert converter.get_status().missing_pairs[0].reason == "rate_not_found"


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
