import pytest
from fastapi import HTTPException
from hypothesis import given
from hypothesis import strategies as st

from app.models.currency import Currency
from app.services.importers.generic.amounts import parse_import_amount_to_minor_units

CAD = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
JPY = Currency(id="JPY", name="Japanese Yen", symbol="¥", minor_unit_exponent=0)


def _make_test_currency(minor_unit_exponent):
    """Return currency metadata for generated amount parsing tests"""
    return Currency(
        id="TST",
        name="Test Currency",
        symbol="$",
        minor_unit_exponent=minor_unit_exponent,
    )


def _format_minor_units(minor_units, minor_unit_exponent):
    """Return import amount text representing the provided minor-unit value"""
    sign = "-" if minor_units < 0 else ""
    absolute_minor_units = abs(minor_units)
    minor_unit_multiplier = 10**minor_unit_exponent
    whole_units, fractional_units = divmod(absolute_minor_units, minor_unit_multiplier)

    if minor_unit_exponent == 0:
        return f"{sign}{whole_units:,}"

    fractional_text = f"{fractional_units:0{minor_unit_exponent}d}"
    return f"{sign}{whole_units:,}.{fractional_text}"


@pytest.mark.parametrize(
    ("raw_amount", "currency", "expected_minor_units"),
    [
        ("-12.34", CAD, -1234),
        ("1,234.56", CAD, 123456),
        (" 99.99 ", CAD, 9999),
        ("1,234", JPY, 1234),
    ],
)
def test_parse_import_amount_to_minor_units_returns_minor_units(raw_amount, currency, expected_minor_units):
    """Import amount parsing returns currency minor units for accepted decimal text"""
    parsed_amount = parse_import_amount_to_minor_units(raw_amount, currency)

    assert parsed_amount == expected_minor_units


def test_parse_import_amount_to_minor_units_rejects_malformed_text():
    """Import amount parsing raises a 422 error for malformed amount text"""
    with pytest.raises(HTTPException) as exc_info:
        parse_import_amount_to_minor_units("$12.34", CAD)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Invalid amount: $12.34"


def test_parse_import_amount_to_minor_units_rejects_too_many_decimal_places():
    """Import amount parsing raises a 422 error when currency precision is exceeded"""
    with pytest.raises(HTTPException) as exc_info:
        parse_import_amount_to_minor_units("12.345", CAD)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Amount has too many decimal places for CAD: 12.345"


@given(
    minor_units=st.integers(min_value=-999_999_999, max_value=999_999_999),
    minor_unit_exponent=st.integers(min_value=0, max_value=4),
    has_padding=st.booleans(),
    has_positive_sign=st.booleans(),
)
def test_parse_import_amount_to_minor_units_preserves_generated_minor_units(
    minor_units,
    minor_unit_exponent,
    has_padding,
    has_positive_sign,
):
    """Import amount parsing preserves generated minor-unit values"""
    currency = _make_test_currency(minor_unit_exponent)
    raw_amount = _format_minor_units(minor_units, minor_unit_exponent)
    if has_positive_sign and minor_units >= 0:
        raw_amount = f"+{raw_amount}"

    if has_padding:
        raw_amount = f" {raw_amount} "

    parsed_amount = parse_import_amount_to_minor_units(raw_amount, currency)

    assert parsed_amount == minor_units


@given(
    whole_units=st.integers(min_value=-999_999, max_value=999_999),
    minor_unit_exponent=st.integers(min_value=0, max_value=4),
    excess_digit=st.integers(min_value=1, max_value=9),
)
def test_parse_import_amount_to_minor_units_rejects_generated_excess_precision(
    whole_units,
    minor_unit_exponent,
    excess_digit,
):
    """Import amount parsing rejects generated amounts below currency precision"""
    currency = _make_test_currency(minor_unit_exponent)
    fractional_text = f"{'0' * minor_unit_exponent}{excess_digit}"
    raw_amount = f"{whole_units}.{fractional_text}"

    with pytest.raises(HTTPException) as exc_info:
        parse_import_amount_to_minor_units(raw_amount, currency)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == f"Amount has too many decimal places for TST: {raw_amount}"
