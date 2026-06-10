"""User date helpers"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.models.user import User


def get_current_user_date(user: User) -> date:
    """Return the current date for a user's timezone

    Args:
        user: Authenticated user

    Returns:
        Current date in the user's timezone
    """
    current_date = datetime.now(ZoneInfo(user.tz)).date()
    return current_date
