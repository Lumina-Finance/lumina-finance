"""Money amount utility helpers"""
import re
from decimal import Decimal, InvalidOperation

_RAW_DECIMAL_AMOUNT_RE = re.compile(r"^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$")


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

    return int(minor_units)
