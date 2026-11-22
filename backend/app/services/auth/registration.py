"""Registration gate shared by every route that creates an account"""

from fastapi import HTTPException, status

from app.config.registration import REGISTRATION_ENABLED
from app.signup_check_hook import is_signup_allowed

# Shown for closed registration and for a provider sign-in the sign-up check refuses, so the second
# never says why it was refused
REGISTRATION_CLOSED_DETAIL = "Registration is closed on this instance"


def is_registration_open() -> bool:
    """Return whether REGISTRATION_ENABLED allows new accounts to be created"""
    return REGISTRATION_ENABLED


def reject_closed_registration() -> None:
    """Refuse account creation while REGISTRATION_ENABLED is false

    Raises:
        HTTPException: Registration is closed
    """
    if not is_registration_open():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=REGISTRATION_CLOSED_DETAIL)


async def reject_refused_provider_signup(email: str) -> None:
    """Refuse a first provider sign-in for an address the installed sign-up check refuses

    A provider sign-in has no email to withhold, so it answers as closed registration does

    Raises:
        HTTPException: The sign-up check refused the address
    """
    if not await is_signup_allowed(email):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=REGISTRATION_CLOSED_DETAIL)
