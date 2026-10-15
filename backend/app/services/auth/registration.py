"""Registration gate shared by every route that creates an account"""

from fastapi import HTTPException, status

from app.config.registration import REGISTRATION_ENABLED


def is_registration_open() -> bool:
    """Return whether REGISTRATION_ENABLED allows new accounts to be created"""
    return REGISTRATION_ENABLED


def reject_closed_registration() -> None:
    """Refuse account creation while REGISTRATION_ENABLED is false

    Raises:
        HTTPException: Registration is closed
    """
    if not is_registration_open():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Registration is closed on this instance")
