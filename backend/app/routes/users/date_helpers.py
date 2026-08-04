"""User date helpers"""
from datetime import date, datetime

from app.models.user import User
from app.utils.dates import resolve_timezone


def get_current_user_date(user: User) -> date:
    """Return the current date for a user's timezone

    Args:
        user: Authenticated user

    Returns:
        Current date in the user's timezone

    Raises:
        HTTPException: Stored timezone is not a zone the app recognizes
    """
    current_date = datetime.now(resolve_timezone(user.tz)).date()
    return current_date
