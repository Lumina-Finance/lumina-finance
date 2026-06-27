"""Two-factor enrolment and management flows spanning TOTP and recovery codes"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth.recovery_codes import (
    consume_recovery_code,
    delete_recovery_codes,
    generate_recovery_codes,
    has_recovery_codes,
)
from app.services.auth.step_up import verify_step_up
from app.services.auth.totp import (
    disable_totp,
    is_pending_totp_code_valid,
    is_totp_enabled,
    is_user_totp_code_valid,
    mark_totp_confirmed,
)

# Shared message so disabling and regenerating reject identically when 2FA is off
_NOT_ENABLED_DETAIL = "Two-factor authentication is not enabled"


async def verify_login_second_factor(db: AsyncSession, user_id: uuid.UUID, code: str) -> None:
    """Verify the second factor presented at login

    A valid TOTP code passes login unchanged. A recovery code instead is treated as a lost
    authenticator: it is consumed, the TOTP secret is revoked, and re-enrolment is required, so the
    session is held to the re-enrol flow until a fresh authenticator is confirmed. The caller commits

    Args:
        db: Active database session
        user_id: User completing the second factor
        code: Submitted TOTP code or recovery code

    Raises:
        HTTPException: Neither a TOTP code nor a recovery code verifies
    """
    if await is_user_totp_code_valid(db, user_id, code):
        return

    if await consume_recovery_code(db, user_id, code):
        await disable_totp(db, user_id)
        user = await db.get(User, user_id)
        user.totp_reenrollment_required = True
        return

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid code")


async def confirm_totp_enrollment(db: AsyncSession, user_id: uuid.UUID, code: str) -> list[str]:
    """Verify the first code and issue recovery codes, leaving two-factor pending until completion

    Two-factor stays off until the user acknowledges the codes through complete_totp_enrollment, so
    closing the recovery code screen never leaves the account half protected

    Args:
        db: Active database session
        user_id: User confirming enrolment
        code: Code from the authenticator app

    Returns:
        The plaintext recovery codes to show once

    Raises:
        HTTPException: No pending setup exists or the code is invalid
    """
    if not await is_pending_totp_code_valid(db, user_id, code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    codes = await generate_recovery_codes(db, user_id)
    await db.commit()
    return codes


async def complete_totp_enrollment(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Turn on two-factor once the user has acknowledged their recovery codes

    Recovery codes only exist after a confirmed code, so requiring them keeps two-factor from being
    enabled around an unverified secret

    Args:
        db: Active database session
        user_id: User finishing enrolment

    Raises:
        HTTPException: Enrolment was not confirmed first, or there is no pending setup
    """
    if not await has_recovery_codes(db, user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Confirm an authenticator code first")

    if not await mark_totp_confirmed(db, user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No pending two-factor setup to finish")

    await db.commit()


async def reenroll_totp(db: AsyncSession, user_id: uuid.UUID, code: str) -> None:
    """Re-enable TOTP after a recovery-code login and lift the re-enrolment restriction

    Only a session already flagged for re-enrolment may use this, so it cannot turn on TOTP without
    the acknowledged recovery codes the normal enrolment requires. Recovery codes are left untouched
    so the remaining batch keeps depleting one per recovery-code login

    Args:
        db: Active database session
        user_id: User re-enrolling after a recovery-code login
        code: Code from the freshly set up authenticator

    Raises:
        HTTPException: No re-enrolment is pending, or the code does not verify
    """
    user = await db.get(User, user_id)
    if user is None or not user.totp_reenrollment_required:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No re-enrolment is required")

    if not await is_pending_totp_code_valid(db, user_id, code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    await mark_totp_confirmed(db, user_id)
    user.totp_reenrollment_required = False
    await db.commit()


async def disable_two_factor(db: AsyncSession, user: User, password: str, code: str) -> None:
    """Disable TOTP and clear the recovery codes after step-up reauthentication

    Args:
        db: Active database session
        user: Authenticated user disabling two-factor
        password: Account password
        code: A current TOTP code or a recovery code

    Raises:
        HTTPException: Two-factor is not enabled, or the step-up check fails
    """
    if not await is_totp_enabled(db, user.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_ENABLED_DETAIL)

    await verify_step_up(db, user, password, code)
    await disable_totp(db, user.id)
    await delete_recovery_codes(db, user.id)
    await db.commit()


async def regenerate_recovery_codes(db: AsyncSession, user: User, password: str, code: str) -> list[str]:
    """Replace the recovery codes after step-up reauthentication

    Args:
        db: Active database session
        user: Authenticated user regenerating codes
        password: Account password
        code: A current TOTP code or a recovery code

    Returns:
        The fresh plaintext recovery codes to show once

    Raises:
        HTTPException: Two-factor is not enabled, or the step-up check fails
    """
    if not await is_totp_enabled(db, user.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_ENABLED_DETAIL)

    await verify_step_up(db, user, password, code)
    codes = await generate_recovery_codes(db, user.id)
    await db.commit()
    return codes
