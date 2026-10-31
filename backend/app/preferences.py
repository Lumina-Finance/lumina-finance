"""The display preferences a profile stores"""

from typing import Literal, get_args

# Order of a displayed date, where iso gives 2026-09-24
DateFormat = Literal["month-day-year", "day-month-year", "iso"]

DATE_FORMATS: tuple[str, ...] = get_args(DateFormat)

# How dates were written before the setting existed, and the starting value of every account
DEFAULT_DATE_FORMAT = "month-day-year"

# The key held with a letter to reach a field in the transaction dialogue. Alt is Option on a Mac, and the
# left one leaves the right one free to type symbols
ActionKey = Literal["alt", "left-alt"]

ACTION_KEYS: tuple[str, ...] = get_args(ActionKey)

# The key the shortcuts use before anyone chooses, and the starting value of every account
DEFAULT_ACTION_KEY = "alt"
