"""The window of dates the app accepts, and the longest span a report covers"""

from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import HTTPException, status
from pydantic import AfterValidator
from pydantic_core import PydanticCustomError

EARLIEST_ALLOWED_DATE = date(1900, 1, 1)
ALLOWED_YEARS_AHEAD = 10
MAX_RANGE_YEARS = 20

# The furthest ahead any calendar is, so no user is refused a date within ten years of their own
# today. A schema cannot see the profile's timezone, so the window cannot start from it
_LATEST_UTC_OFFSET = timezone(timedelta(hours=14))

_BEFORE_WINDOW_MESSAGE = "must be on or after 1 January 1900"
_AFTER_WINDOW_MESSAGE = "must be within ten years of today"
_RANGE_TOO_LONG_MESSAGE = "Range can cover at most 20 years"


def get_latest_calendar_today() -> date:
    """Return today's date in the furthest-ahead timezone, the latest date any user is on"""
    return datetime.now(_LATEST_UTC_OFFSET).date()


def add_years(start: date, years: int) -> date:
    """Return the date a whole number of years after another, landing 29 February on 28 February"""
    try:
        return start.replace(year=start.year + years)
    except ValueError:
        return start.replace(year=start.year + years, day=28)


def get_latest_allowed_date() -> date:
    """Return the last date inside the window"""
    return add_years(get_latest_calendar_today(), ALLOWED_YEARS_AHEAD)


def get_window_error(value: date) -> str | None:
    """Return why a date is outside the window, such as "must be on or after 1 January 1900", or None inside it"""
    if value < EARLIEST_ALLOWED_DATE:
        return _BEFORE_WINDOW_MESSAGE
    if value > get_latest_allowed_date():
        return _AFTER_WINDOW_MESSAGE
    return None


def _require_in_window(value: date) -> date:
    """Refuse a date outside the window, with a message the field shows as it is"""
    error = get_window_error(value)
    if error is not None:
        raise PydanticCustomError("date_outside_window", "Date {error}", {"error": error})
    return value


WindowDate = Annotated[date, AfterValidator(_require_in_window)]


def require_optional_report_range(from_date: date | None, to_date: date | None) -> None:
    """Refuse a report range with ends that are set and outside the window

    A range with one end open is held to the window only, and one with both ends set to everything
    ``require_report_range`` checks

    Args:
        from_date: Inclusive first date of the range, or None for no lower end
        to_date: Inclusive last date of the range, or None for no upper end

    Raises:
        HTTPException: 422 with a message naming the field at fault
    """
    if from_date is not None and to_date is not None:
        require_report_range(from_date, to_date)
        return
    for label, value in (("Start date", from_date), ("End date", to_date)):
        error = get_window_error(value) if value is not None else None
        if error is not None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} {error}")


def require_report_range(from_date: date, to_date: date) -> None:
    """Refuse a report range whose ends sit outside the window, are reversed or cover over 20 years

    Args:
        from_date: Inclusive first date of the range
        to_date: Inclusive last date of the range

    Raises:
        HTTPException: 422 with a message naming the field at fault
    """
    for label, value in (("Start date", from_date), ("End date", to_date)):
        error = get_window_error(value)
        if error is not None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} {error}")
    if from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")
    if to_date >= add_years(from_date, MAX_RANGE_YEARS):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_RANGE_TOO_LONG_MESSAGE)
