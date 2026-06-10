import pytest
from fastapi import HTTPException

from app.models.currency import Currency
from app.services.transactions.imports.amounts import parse_import_amount_to_minor_units

CAD = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
JPY = Currency(id="JPY", name="Japanese Yen", symbol="¥", minor_unit_exponent=0)


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
