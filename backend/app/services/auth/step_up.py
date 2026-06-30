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
from app.services.auth.webauthn import verify_passkey_second_factor


async def verify_step_up(
    db: AsyncSession,
    user: User,
    password: str,
    *,
    code: str | None = None,
    passkey: dict | None = None,
) -> None:
    """Authorize a sensitive two-factor change with the password and a current second factor

    Step-up takes the password, then a real second factor: a passkey, which is preferred, or a TOTP
    code. A recovery code is never accepted here, since it is a login-only break-glass that means the
    real factors are gone, so it routes through the destructive recovery sign-in instead. Step-up shares
    the login lockout counter, so a session cannot grind the password or a factor here any more than it
    can at login, and tripping the lock signs every session out. The caller commits

    Args:
        db: Active database session
        user: Authenticated user performing the change
        password: Account password
        code: A current TOTP code, when verifying by authenticator
        passkey: A passkey assertion, when verifying by passkey, taking priority over a code

    Raises:
        HTTPException: The account is locked, the password is wrong, no factor was supplied, or the
            supplied factor does not verify
    """
    credential = await get_password_credential(db, user.id)
    if credential is not None and is_account_locked(credential):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")

    if credential is None or not is_password_valid(password, credential.password_hash):
        if credential is not None:
            await record_failed_attempt(db, credential)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if passkey is not None:
        try:
            await verify_passkey_second_factor(db, user.id, passkey)
        except HTTPException:
            await record_failed_attempt(db, credential)
            raise
    elif code is not None:
        if not await is_user_totp_code_valid(db, user.id, code):
            await record_failed_attempt(db, credential)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid two-factor code")
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A second factor is required")

    await reset_failed_attempts(db, credential)
