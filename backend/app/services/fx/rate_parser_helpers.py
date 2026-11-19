"""Foreign exchange rate parser helpers"""

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.services.fx.errors import FxRateResponseError

# The range a published rate falls in. Cross rates between the supported currencies, such as IRR, LBP,
# VND and KWD, come within one order of magnitude of 0.000001 and 1,000,000, so the range reaches three
# orders further each way. It keeps a rate such as 1E+999999 from reaching a multiplication
MIN_PLAUSIBLE_RATE = Decimal("0.000000001")
MAX_PLAUSIBLE_RATE = Decimal("1000000000")


def is_plausible_rate(rate: Decimal) -> bool:
    """Return whether a rate is a number the provider could have published

    Args:
        rate: Quote currency units per one base currency unit

    Returns:
        True when the rate is finite and between 0.000000001 and 1,000,000,000
    """
    return rate.is_finite() and MIN_PLAUSIBLE_RATE <= rate <= MAX_PLAUSIBLE_RATE


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

    if not is_plausible_rate(rate):
        raise FxRateResponseError("FX provider returned an invalid rate")

    rate_record = (rate_date, rate)
    return rate_record
