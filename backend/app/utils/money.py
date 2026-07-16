"""Money amount utilities"""
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

_RAW_DECIMAL_AMOUNT_RE = re.compile(r"^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$")

# Amounts are stored as signed 64-bit integers, so a parsed value past this
# magnitude would only fail later at database flush instead of being rejected
# where the string is validated
MAX_MINOR_UNITS_MAGNITUDE = 2**63 - 1


class DecimalAmountParseError(ValueError):
    """Raised when a decimal amount string is malformed"""


class DecimalAmountPrecisionError(ValueError):
    """Raised when a decimal amount has too many fractional digits"""


def parse_decimal_amount_to_minor_units(
    raw_amount: str,
    *,
    currency_code: str,
    minor_unit_exponent: int,
) -> int:
    """Parse a decimal amount string into currency minor units

    Args:
        raw_amount: User-supplied decimal amount string
        currency_code: Currency code used in precision error details
        minor_unit_exponent: Number of decimal places supported by the currency

    Returns:
        Parsed amount in the currency's minor units

    Raises:
        DecimalAmountParseError: Raised when the amount string is malformed
        DecimalAmountPrecisionError: Raised when the amount has too many decimal places
    """
    normalized_amount = raw_amount.strip()
    if not _RAW_DECIMAL_AMOUNT_RE.fullmatch(normalized_amount):
        raise DecimalAmountParseError(f"Invalid amount: {raw_amount}")

    try:
        decimal_amount = Decimal(normalized_amount.replace(",", ""))
    except InvalidOperation as exc:
        raise DecimalAmountParseError(f"Invalid amount: {raw_amount}") from exc

    multiplier = Decimal(10) ** minor_unit_exponent
    minor_units = decimal_amount * multiplier
    if minor_units != minor_units.to_integral_value():
        raise DecimalAmountPrecisionError(f"Amount has too many decimal places for {currency_code}: {raw_amount}")

    if abs(minor_units) > MAX_MINOR_UNITS_MAGNITUDE:
        raise DecimalAmountParseError(f"Amount is too large: {raw_amount}")

    return int(minor_units)


def convert_minor_units_between_currencies(
    amount: int,
    *,
    rate: Decimal,
    base_exponent: int,
    quote_exponent: int,
) -> int:
    """Convert minor units using a currency rate and minor-unit exponents

    Args:
        amount: Source amount in base currency minor units
        rate: Quote currency units per one base currency unit
        base_exponent: Minor-unit exponent for the source currency
        quote_exponent: Minor-unit exponent for the target currency

    Returns:
        Converted amount in quote currency minor units
    """
    base_units = Decimal(10) ** base_exponent
    quote_units = Decimal(10) ** quote_exponent
    converted_amount = (Decimal(amount) / base_units) * rate * quote_units
    rounded_minor_units = int(converted_amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return rounded_minor_units
