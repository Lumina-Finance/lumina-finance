"""Decimal amount parsing tests

The properties check the law: an amount in minor units written as decimal text parses back to the same
units, and any text is either read as exactly the amount it spells or refused, never altered. The
examples pin the amounts a file really carries, the bounds of the stored range and the odd text that
once got through
"""

from fractions import Fraction

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.utils.money import (
    MAX_MINOR_UNITS,
    MIN_MINOR_UNITS,
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)
from tests.routes.support.generators import INT64_MAX, INT64_MIN, currency_exponents, minor_units, write_minor_units

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


# Characters that make text almost an amount: digits, signs, separators, padding, a currency mark,
# a Latin and an Arabic-Indic digit and the exponent letter
_NO_BREAK_SPACE = chr(0xA0)
_ARABIC_INDIC_DIGIT_ONE = chr(0x661)
_LOOKALIKE_ALPHABET = "0123456789+-., _'$e" + _NO_BREAK_SPACE + _ARABIC_INDIC_DIGIT_ONE

# Text of every shape the importers meet: anything at all, near misses made of the characters above,
# and amounts written with more decimal places than the currency holds, whose extremes reach past the range
_amount_texts = st.one_of(
    st.text(),
    st.text(alphabet=_LOOKALIKE_ALPHABET, max_size=12),
    st.builds(write_minor_units, minor_units, st.integers(min_value=0, max_value=8)),
)

_ASCII_DIGITS = frozenset("0123456789")


def _meaning(raw_amount):
    """Return the exact amount a plain signed decimal text spells, or None for any other text"""
    unsigned = raw_amount[1:] if raw_amount.startswith(("+", "-")) else raw_amount
    parts = unsigned.split(".")
    if len(parts) > 2 or not all(part and set(part) <= _ASCII_DIGITS for part in parts):
        return None
    whole, fraction = parts[0], "".join(parts[1:])
    magnitude = Fraction(int(whole + fraction), 10 ** len(fraction))
    return -magnitude if raw_amount.startswith("-") else magnitude


@given(amount=minor_units, exponent=currency_exponents, extra_zeros=st.integers(min_value=0, max_value=3))
def test_a_written_amount_parses_back_to_the_same_minor_units(amount, exponent, extra_zeros):
    """Writing an amount out and parsing it back returns it, at every exponent and across the stored range

    Zeros past the currency's places carry no precision, so they change nothing
    """
    written = write_minor_units(amount, exponent)
    if extra_zeros:
        written += ("." if exponent == 0 else "") + "0" * extra_zeros

    assert _parse(written, exponent) == amount


@given(raw_amount=_amount_texts, exponent=currency_exponents)
def test_text_is_parsed_to_exactly_the_amount_it_spells_or_refused(raw_amount, exponent):
    """Any text is refused, or parsed to exactly the amount it spells, never to another one

    Text that is not a plain decimal is refused, so is one holding digits the currency lacks or an
    amount outside the stored range, and the rest parses
    """
    meaning = _meaning(raw_amount)
    if meaning is None:
        with pytest.raises(DecimalAmountParseError):
            _parse(raw_amount, exponent)
        return

    exact = meaning * 10**exponent
    if exact.denominator != 1:
        with pytest.raises(DecimalAmountPrecisionError):
            _parse(raw_amount, exponent)
    elif not INT64_MIN <= exact <= INT64_MAX:
        with pytest.raises(DecimalAmountParseError):
            _parse(raw_amount, exponent)
    else:
        assert _parse(raw_amount, exponent) == exact


@pytest.mark.parametrize(
    ("raw_amount", "minor_unit_exponent", "expected_minor_units"),
    [
        ("12.34", 2, 1234),
        ("-0.00", 2, 0),
    ],
)
def test_parses_amounts_the_currency_can_hold(raw_amount, minor_unit_exponent, expected_minor_units):
    """An amount within the currency's decimal places parses to its minor units"""
    assert _parse(raw_amount, minor_unit_exponent) == expected_minor_units


@pytest.mark.parametrize(
    "raw_amount",
    [
        " 12.34",
        "12.34 ",
        "\t12.34",
        "12.34\n",
        "\u00a012.34",
        "12.34\ufeff",
        "12.",
        ".5",
    ],
)
def test_refuses_amounts_that_are_not_normalized(raw_amount):
    """The backend accepts complete decimal text without padding or grouping"""
    with pytest.raises(DecimalAmountParseError):
        _parse(raw_amount)


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


@pytest.mark.parametrize(
    "raw_amount",
    [
        " \t\ufeff",
        "\u000012.34",
        "\u180e12.34",
        "\u200b12.34",
    ],
)
def test_refuses_malformed_amount_text(raw_amount):
    """Text that is not a plain signed decimal number is refused"""
    with pytest.raises(DecimalAmountParseError):
        _parse(raw_amount)


@pytest.mark.parametrize(
    "raw_amount",
    ["١٢.٣٤", "\uff11\uff12.\uff13\uff14", "\u06612.34", "12.3٤", "1,23٤.56", "\U0001d7d92.34"],
)
def test_refuses_decimal_digits_outside_ascii(raw_amount):
    """Canonical amounts refuse non-ASCII decimal digits wherever they appear"""
    with pytest.raises(DecimalAmountParseError):
        _parse(raw_amount)


@pytest.mark.parametrize("padding", ["\u001c", "\u001d", "\u001e", "\u001f", "\u0085"])
def test_refuses_python_only_surrounding_whitespace(padding):
    """Normalized amounts refuse surrounding control characters"""
    with pytest.raises(DecimalAmountParseError):
        _parse(f"{padding}12.34{padding}")
