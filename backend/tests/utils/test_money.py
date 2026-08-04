"""Decimal amount parsing tests"""

import pytest

from app.utils.money import (
    MAX_MINOR_UNITS,
    MIN_MINOR_UNITS,
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)

# The largest and smallest amounts a two-decimal currency can hold, written as the decimal
# text a file would carry. Their minor-unit values are the bounds of a signed 64-bit column
LARGEST_STORABLE_TEXT = "92233720368547758.07"
SMALLEST_STORABLE_TEXT = "-92233720368547758.08"


def _parse(raw_amount, minor_unit_exponent=2):
    """Parse an amount against a currency with the given number of decimal places"""
    return parse_decimal_amount_to_minor_units(
        raw_amount,
        currency_code="TST",
        minor_unit_exponent=minor_unit_exponent,
    )


@pytest.mark.parametrize(
    ("raw_amount", "minor_unit_exponent", "expected_minor_units"),
    [
        ("12.34", 2, 1234),
        ("-12.34", 2, -1234),
        ("1,234.56", 2, 123456),
        # Trailing zeros past the currency's places carry no precision, so they are not
        # the same thing as a digit the currency cannot hold
        ("12.3400", 2, 1234),
        ("1234", 0, 1234),
        ("1.234", 3, 1234),
    ],
)
def test_parses_amounts_the_currency_can_hold(raw_amount, minor_unit_exponent, expected_minor_units):
    """An amount within the currency's decimal places parses to its minor units"""
    assert _parse(raw_amount, minor_unit_exponent) == expected_minor_units


@pytest.mark.parametrize(
    ("raw_amount", "minor_unit_exponent"),
    [
        ("12.345", 2),
        ("1.005", 2),
        ("12.34", 0),
        ("1.2345", 3),
    ],
)
def test_refuses_an_amount_carrying_more_decimal_places_than_the_currency(raw_amount, minor_unit_exponent):
    """An amount with more decimal places than the currency holds is refused, not rounded"""
    with pytest.raises(DecimalAmountPrecisionError):
        _parse(raw_amount, minor_unit_exponent)


def test_refuses_excess_precision_past_the_default_decimal_context():
    """Precision beyond 28 significant digits is refused rather than rounded away first

    Scaling inside the default context rounds the value to fit before the integral check
    runs, which let an amount like this one parse as a whole 100 minor units
    """
    with pytest.raises(DecimalAmountPrecisionError):
        _parse("1.0000000000000000000000000005")


def test_refuses_excess_precision_that_rounds_onto_the_largest_storable_amount():
    """An over-precise amount is refused even where rounding it would land exactly in range"""
    with pytest.raises(DecimalAmountPrecisionError):
        _parse("92233720368547758.070000000001")


def test_parses_the_bounds_of_the_signed_range_the_column_holds():
    """Both ends of the signed 64-bit range parse, including the asymmetric negative end"""
    assert _parse(LARGEST_STORABLE_TEXT) == MAX_MINOR_UNITS
    assert _parse(SMALLEST_STORABLE_TEXT) == MIN_MINOR_UNITS


@pytest.mark.parametrize("raw_amount", ["92233720368547758.08", "-92233720368547758.09"])
def test_refuses_an_amount_past_the_range_the_column_holds(raw_amount):
    """An amount one minor unit outside the signed 64-bit range is refused"""
    with pytest.raises(DecimalAmountParseError):
        _parse(raw_amount)


@pytest.mark.parametrize("raw_amount", ["$12.34", "12,34", "1.234.567", "", "twelve"])
def test_refuses_malformed_amount_text(raw_amount):
    """Text that is not a plain signed decimal number is refused"""
    with pytest.raises(DecimalAmountParseError):
        _parse(raw_amount)
