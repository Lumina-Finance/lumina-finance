"""Step-up reauthentication for sensitive two-factor changes"""

from typing import NoReturn

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordCredential
from app.models.user import User
from app.schemas.auth import StepUpRequest
from app.services.auth.account_lockout import (
    get_password_credential,
    is_account_locked,
    record_failed_attempt,
    reset_failed_attempts,
)
from app.services.auth.password_helpers import is_password_valid
from app.services.auth.totp import is_totp_enabled, is_user_totp_code_valid
from app.services.auth.webauthn import is_passkey_registered, verify_passkey_second_factor

# Carries how many step-up attempts remain before the shared lockout trips, so the client can warn the
# user that another wrong entry locks the account and signs every session out
_ATTEMPTS_REMAINING_HEADER = "X-Auth-Attempts-Remaining"


async def _reject_failed_step_up(db: AsyncSession, credential: PasswordCredential, detail: str) -> NoReturn:
    """Record a failed step-up attempt and reject it, reporting the remaining allowance to the client

    The header lets the caller show how close the account is to the lockout that signs every session
    out, so a fumbling owner is warned before the last try rather than logged out with no notice

    Args:
        db: Active database session
        credential: Password credential receiving the failed attempt
        detail: Message naming which part of the step-up failed

    Raises:
        HTTPException: Always, a 401 carrying the attempts-remaining header
    """
    remaining = await record_failed_attempt(db, credential)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={_ATTEMPTS_REMAINING_HEADER: str(remaining)},
    )


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

    if credential is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not is_password_valid(password, credential.password_hash):
        await _reject_failed_step_up(db, credential, "Invalid credentials")

    if passkey is not None:
        try:
            await verify_passkey_second_factor(db, user.id, passkey)
        except HTTPException as error:
            # A wrong passkey is a failed factor and counts toward the lockout, but a protocol error
            # such as an expired or malformed challenge (400) does not, so a slow or fumbled ceremony
            # cannot lock the account
            if error.status_code == status.HTTP_401_UNAUTHORIZED:
                remaining = await record_failed_attempt(db, credential)
                error.headers = {**(error.headers or {}), _ATTEMPTS_REMAINING_HEADER: str(remaining)}
            raise
    elif code is not None:
        if not await is_user_totp_code_valid(db, user.id, code):
            await _reject_failed_step_up(db, credential, "Invalid two-factor code")
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A second factor is required")

    await reset_failed_attempts(db, credential)


async def verify_sensitive_action_step_up(
    db: AsyncSession,
    user: User,
    password: str,
    *,
    code: str | None = None,
    passkey: dict | None = None,
) -> None:
    """Authorize a sensitive account change, stepping up with a current factor when one exists

    An account that already holds a second factor takes the full step-up, the password plus a current
    passkey or TOTP code. An account with no factor yet has nothing to present, so the password alone
    gates the change while still sharing the login lockout, otherwise a session holder could grind it
    without the counter that protects the login and step-up paths. The caller commits any change on top

    Args:
        db: Active database session
        user: Authenticated user performing the change
        password: Account password
        code: A current TOTP code, when stepping up by authenticator
        passkey: A passkey assertion, when stepping up by passkey, taking priority over a code

    Raises:
        HTTPException: The account is locked, the password is wrong, or a required factor is missing or
            does not verify
    """
    if await is_totp_enabled(db, user.id) or await is_passkey_registered(db, user.id):
        await verify_step_up(db, user, password, code=code, passkey=passkey)
        return

    credential = await get_password_credential(db, user.id)
    if credential is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if is_account_locked(credential):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")
    if not is_password_valid(password, credential.password_hash):
        await _reject_failed_step_up(db, credential, "Invalid credentials")
    await reset_failed_attempts(db, credential)


async def authorize_factor_addition(db: AsyncSession, user: User, step_up: StepUpRequest | None) -> None:
    """Reauthorize adding a second factor, unless a forced re-enrol session is re-establishing one

    Adding a factor is a sensitive change, so it steps up the same way removing one does, which stops a
    stolen access token from silently planting an attacker factor. A forced re-enrol session already
    proved identity with a recovery code at login and has no factor left to present, so it bootstraps a
    fresh factor without stepping up again

    Args:
        db: Active database session
        user: Authenticated user adding the factor
        step_up: Reauthorization payload, required unless the user is under a forced re-enrol

    Raises:
        HTTPException: Reauthorization is required but missing, the account is locked, or the step-up
            does not verify
    """
    if user.second_factor_reenrollment_required:
        return

    if step_up is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Reauthentication is required to add a second factor",
        )
    await verify_sensitive_action_step_up(db, user, step_up.password, code=step_up.code, passkey=step_up.passkey)
