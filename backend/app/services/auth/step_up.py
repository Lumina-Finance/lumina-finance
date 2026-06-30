"""Step-up reauthentication for sensitive two-factor changes"""

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth.account_lockout import (
    get_password_credential,
    is_account_locked,
    record_failed_attempt,
    reset_failed_attempts,
)
from app.services.auth.password_helpers import is_password_valid
from app.services.auth.totp import is_user_totp_code_valid


async def verify_step_up(db: AsyncSession, user: User, password: str, code: str) -> None:
    """Authorize a sensitive two-factor change with the password and a current authenticator code

    Step-up shares the login lockout counter, so a session cannot grind the password or the
    authenticator here any more than it can at login, and tripping the lock signs every session out.
    Step-up accepts only a primary factor and a TOTP code, never a recovery code: a recovery code is a
    break-glass key for login that forces re-enrolment, so allowing it here would let it rotate or
    disable two-factor in session and renew itself indefinitely. The caller commits

    Args:
        db: Active database session
        user: Authenticated user performing the change
        password: Account password
        code: A current TOTP code

    Raises:
        HTTPException: The account is locked, or the password or authenticator code does not verify
    """
    credential = await get_password_credential(db, user.id)
    if credential is not None and is_account_locked(credential):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")

    if credential is None or not is_password_valid(password, credential.password_hash):
        if credential is not None:
            await record_failed_attempt(db, credential)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not await is_user_totp_code_valid(db, user.id, code):
        await record_failed_attempt(db, credential)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid two-factor code")

    await reset_failed_attempts(db, credential)
