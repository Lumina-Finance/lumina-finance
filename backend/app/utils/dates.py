"""Date utilities"""
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status

# Which profile a timezone was read from, so a refusal points at the setting that has to change.
# Two of these are worded without saying whose profile it is, because the same row is read both by
# its owner and by everyone sharing it, and only the first of them can act on "your profile"
OWN_PROFILE = "your profile"
ACCOUNT_OWNER_PROFILE = "the profile that owns this account"
CATEGORY_OWNER_PROFILE = "the profile that owns this category"


def resolve_timezone(tz: str, *, stored_on: str = OWN_PROFILE) -> ZoneInfo:
    """Return the zone for a stored IANA identifier

    A stored identifier can outlive the zone database that accepted it, and every date the product
    reports is calculated in one, so an identifier that no longer resolves refuses the request
    rather than falling back to a calendar the user never chose

    Args:
        tz: IANA timezone identifier read from a stored profile
        stored_on: Whose profile the identifier came from, used in the refusal

    Returns:
        Zone the identifier refers to

    Raises:
        HTTPException: The identifier is not a zone the app recognizes
    """
    try:
        return ZoneInfo(tz)
    # ZoneInfo rejects a path-shaped key with ValueError before it looks anything up, and reports an
    # identifier it cannot find with ZoneInfoNotFoundError
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Timezone '{tz}' saved on {stored_on} is not recognized, so no date could be calculated",
        ) from None


def get_month_start_date(reference: date | datetime) -> date:
    """Return the first day of the month containing a date-like value

    Args:
        reference: Date or datetime used to choose the month

    Returns:
        First day of the reference month
    """
    return date(reference.year, reference.month, 1)


def get_shifted_month_start_date(reference: date | datetime, month_offset: int) -> date:
    """Return the month start offset by a number of calendar months

    Args:
        reference: Date or datetime used as the starting month
        month_offset: Number of months to move forward or backward

    Returns:
        First day of the target month
    """
    start = get_month_start_date(reference)
    month_index = (start.year * 12) + (start.month - 1) + month_offset
    return date(month_index // 12, (month_index % 12) + 1, 1)


def get_next_month_start_date(reference: date | datetime) -> date:
    """Return the first day of the month immediately after a date-like value

    Args:
        reference: Date or datetime used to choose the current month

    Returns:
        First day of the next calendar month
    """
    return get_shifted_month_start_date(reference, 1)


def get_month_start_dates(start_month: date | datetime, count: int) -> list[date]:
    """Return ordered month starts beginning at a month anchor

    Args:
        start_month: Month anchor used as the first emitted month
        count: Number of month starts to emit

    Returns:
        Ordered first-of-month dates
    """
    if count <= 0:
        return []

    start = get_month_start_date(start_month)
    return [get_shifted_month_start_date(start, offset) for offset in range(count)]


def get_recent_month_start_dates(reference: date | datetime, count: int) -> list[date]:
    """Return ordered month starts ending with the reference month

    Args:
        reference: Date or datetime used to choose the final emitted month
        count: Number of month starts to emit

    Returns:
        Oldest-first first-of-month dates ending with the reference month
    """
    if count <= 0:
        return []

    final_month = get_month_start_date(reference)
    start_month = get_shifted_month_start_date(final_month, -(count - 1))
    return get_month_start_dates(start_month, count)
