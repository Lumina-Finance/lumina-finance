"""Shared Hypothesis generators for property tests of money, dates and rates

Every property test of a shared helper draws its amounts, currencies, days and ranges from here, so
two areas that test the same kind of value draw it the same way. Bounds are written out rather than
read from the app, so a bound that drifts in the code fails a property instead of moving with it
"""

from datetime import date, timedelta

from hypothesis import strategies as st

# Signed 64-bit, the range a stored amount in minor units can hold
INT64_MIN = -(2**63)
INT64_MAX = 2**63 - 1

# One decimal place more than any seeded currency uses, so a currency added later stays covered
MAX_CURRENCY_EXPONENT = 4

# The calendar the generated days come from, wide enough to cross leap years and centuries
EARLIEST_DAY = date(1900, 1, 1)
LATEST_DAY = date(2100, 12, 31)

# How far either side of a span's edge a range may fall, so a property meets both sides of it
EDGE_SPREAD_DAYS = 3

currency_exponents = st.integers(min_value=0, max_value=MAX_CURRENCY_EXPONENT)

# Amounts in minor units across the whole stored range, whose extremes Hypothesis favours
minor_units = st.integers(min_value=INT64_MIN, max_value=INT64_MAX)


def calendar_days(earliest: date = EARLIEST_DAY, latest: date = LATEST_DAY) -> st.SearchStrategy[date]:
    """Draw a calendar day between two days, both included"""
    return st.dates(min_value=earliest, max_value=latest)


def date_ranges(earliest: date = EARLIEST_DAY, latest: date = LATEST_DAY) -> st.SearchStrategy[tuple[date, date]]:
    """Draw a range, first day then last, with the first day on or before the last"""
    return st.tuples(calendar_days(earliest, latest), calendar_days(earliest, latest)).map(lambda ends: (min(ends), max(ends)))


def date_ranges_near_span(years: int, earliest: date = EARLIEST_DAY, latest: date = LATEST_DAY) -> st.SearchStrategy[tuple[date, date]]:
    """Draw a range whose last day falls within a few days of the given number of years after its first

    Ranges are cut to the bounds given, so a range straddling the edge of a span still fits a window
    """

    def build(first: date, spread: int) -> tuple[date, date]:
        try:
            edge = first.replace(year=first.year + years)
        except ValueError:
            edge = first.replace(year=first.year + years, day=28)
        return first, edge + timedelta(days=spread)

    # A range starting on 29 February is the case a span's edge treats differently, so it is drawn on purpose
    # Every fourth year from 1904 to 2096 is a leap year, since 1900 and 2100 are not
    leap_days = st.integers(min_value=476, max_value=524).map(lambda n: date(n * 4, 2, 29))
    first_days = st.one_of(calendar_days(earliest, latest), leap_days.filter(lambda day: earliest <= day <= latest))

    return st.builds(
        build,
        first_days,
        st.integers(min_value=-EDGE_SPREAD_DAYS, max_value=EDGE_SPREAD_DAYS),
    ).filter(lambda ends: ends[1] <= latest)


def write_minor_units(amount: int, exponent: int) -> str:
    """Write an amount in minor units as the decimal text importers submit, with every decimal place"""
    sign = "-" if amount < 0 else ""
    digits = str(abs(amount)).rjust(exponent + 1, "0")
    if exponent == 0:
        return f"{sign}{digits}"
    return f"{sign}{digits[:-exponent]}.{digits[-exponent:]}"
