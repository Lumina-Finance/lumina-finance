"""Plausible exchange rate tests: a rate is accepted exactly when it lies in the range a provider could publish"""

from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from app.services.fx.rate_parser_helpers import is_plausible_rate

# The documented range, written out so the properties fail if the code's bounds drift from it
LOWEST_PLAUSIBLE = Decimal("0.000000001")
HIGHEST_PLAUSIBLE = Decimal("1000000000")

_finite = {"allow_nan": False, "allow_infinity": False}

# Each end of the range and the nearest value past it, since random draws almost never land on them
_range_edges = st.sampled_from([LOWEST_PLAUSIBLE, HIGHEST_PLAUSIBLE])
_just_past_the_range = st.sampled_from([LOWEST_PLAUSIBLE - Decimal("1E-18"), HIGHEST_PLAUSIBLE + Decimal("1E-9")])

_rates_inside = st.one_of(
    st.decimals(min_value=LOWEST_PLAUSIBLE, max_value=HIGHEST_PLAUSIBLE, **_finite),
    _range_edges,
)

_rates_outside = st.one_of(
    st.decimals(max_value=LOWEST_PLAUSIBLE, **_finite).filter(lambda rate: rate < LOWEST_PLAUSIBLE),
    st.decimals(min_value=HIGHEST_PLAUSIBLE, **_finite).filter(lambda rate: rate > HIGHEST_PLAUSIBLE),
    _just_past_the_range,
    st.sampled_from([Decimal("NaN"), Decimal("sNaN"), Decimal("Infinity"), Decimal("-Infinity")]),
)


@given(rate=_rates_inside)
def test_a_rate_inside_the_plausible_range_is_accepted(rate):
    """Every rate from 0.000000001 to 1,000,000,000, both ends included, is plausible"""
    assert is_plausible_rate(rate)


@given(rate=_rates_outside)
def test_a_rate_outside_the_plausible_range_is_refused(rate):
    """Zero, a negative rate, one past either end and a rate that is not a finite number are never plausible"""
    assert not is_plausible_rate(rate)
