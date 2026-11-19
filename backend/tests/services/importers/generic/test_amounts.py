"""Import amount parsing tests

The import refuses an amount holding a nonzero digit past its currency's places with a message
naming the currency. The property checks that refusal across the stored range at every exponent.
The shared parser's own properties in `tests/utils/test_money.py` check that a written amount parses
back to its minor units and that other text is refused, and the route tests pin the invalid amount
message
"""

import pytest
from fastapi import HTTPException
from hypothesis import given
from hypothesis import strategies as st

from app.models.currency import Currency
from app.services.importers.generic.amounts import parse_import_amount_to_minor_units
from tests.routes.support.generators import currency_exponents, minor_units, write_minor_units


@given(amount=minor_units, exponent=currency_exponents, excess_digit=st.integers(min_value=1, max_value=9))
def test_import_amount_with_a_digit_past_the_currency_places_is_refused_naming_the_currency(amount, exponent, excess_digit):
    """An amount carrying one more nonzero decimal digit than its currency holds is refused, never rounded"""
    currency = Currency(id="TST", name="Test Currency", symbol="$", minor_unit_exponent=exponent)
    raw_amount = f"{write_minor_units(amount, exponent)}{'.' if exponent == 0 else ''}{excess_digit}"

    with pytest.raises(HTTPException) as exc_info:
        parse_import_amount_to_minor_units(raw_amount, currency)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == f"Amount has too many decimal places for TST: {raw_amount}"
