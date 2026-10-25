"""The display preferences a profile stores"""

from typing import Literal, get_args

# Order of a displayed date, where iso gives 2026-09-24
DateFormat = Literal["month-day-year", "day-month-year", "iso"]

DATE_FORMATS: tuple[str, ...] = get_args(DateFormat)

# How dates were written before the setting existed, and the starting value of every account
DEFAULT_DATE_FORMAT = "month-day-year"
