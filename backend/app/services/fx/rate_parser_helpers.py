"""Foreign exchange rate parser helpers"""

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.services.fx.errors import FxRateResponseError


def parse_rate(payload: dict[str, Any], *, expected_base: str, expected_quote: str) -> Decimal:
    """Return a validated provider rate from a single-rate payload

    Args:
        payload: Raw provider response payload
        expected_base: Expected source currency code
        expected_quote: Expected target currency code

    Returns:
        Quote currency units per one base currency unit
    """
    _, rate = _parse_rate_record(payload, expected_base=expected_base, expected_quote=expected_quote)
    return rate


def parse_rates(payload: Any, *, expected_base: str, expected_quote: str) -> dict[date, Decimal]:
    """Return validated provider rates from a date-series payload

    Args:
        payload: Raw provider response payload
        expected_base: Expected source currency code
        expected_quote: Expected target currency code

    Returns:
        Rates keyed by calendar date
    """
    if not isinstance(payload, list):
        raise FxRateResponseError("FX provider returned an invalid rate series")

    rates: dict[date, Decimal] = {}
    for item in payload:
        rate_date, rate = _parse_rate_record(item, expected_base=expected_base, expected_quote=expected_quote)
        rates[rate_date] = rate
    return rates


def _parse_rate_record(payload: Any, *, expected_base: str, expected_quote: str) -> tuple[date, Decimal]:
    """Return a validated date and rate from one provider payload item

    Args:
        payload: Raw provider payload item
        expected_base: Expected source currency code
        expected_quote: Expected target currency code

    Returns:
        Rate date and quote currency units per one base currency unit
    """
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

    rate_record = (rate_date, rate)
    return rate_record
