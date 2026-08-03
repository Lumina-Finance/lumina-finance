"""Money amount utilities"""
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext

_RAW_DECIMAL_AMOUNT_RE = re.compile(r"^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$")

# Amounts are stored as signed 64-bit integers, so a parsed value outside this
# range would only fail later at database flush instead of being rejected where
# the string is validated. The range is not symmetric: two's complement gives one
# more value below zero than above it, so a caller that negates a parsed amount
# has to bound its own result rather than trusting this one
MIN_MINOR_UNITS = -(2**63)
MAX_MINOR_UNITS = 2**63 - 1


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
        DecimalAmountParseError: Raised when the amount string is malformed, or when the
            amount falls outside the signed 64-bit range the column holds
        DecimalAmountPrecisionError: Raised when the amount has too many decimal places
    """
    normalized_amount = raw_amount.strip()
    if not _RAW_DECIMAL_AMOUNT_RE.fullmatch(normalized_amount):
        raise DecimalAmountParseError(f"Invalid amount: {raw_amount}")

    try:
        decimal_amount = Decimal(normalized_amount.replace(",", ""))
    except InvalidOperation as exc:
        raise DecimalAmountParseError(f"Invalid amount: {raw_amount}") from exc

    # Shifting the decimal point keeps the operand's own digits, so the context has to be
    # wide enough to hold all of them. Under the default 28 the value is rounded to fit
    # first, and an amount carrying more precision than the currency holds then passes the
    # integral check below instead of failing it
    with localcontext() as context:
        context.prec = len(decimal_amount.as_tuple().digits) + minor_unit_exponent + 1
        minor_units = decimal_amount.scaleb(minor_unit_exponent)
        if minor_units != minor_units.to_integral_value():
            raise DecimalAmountPrecisionError(f"Amount has too many decimal places for {currency_code}: {raw_amount}")

    if not MIN_MINOR_UNITS <= minor_units <= MAX_MINOR_UNITS:
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
