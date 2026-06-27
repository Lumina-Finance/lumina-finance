"""Two-factor enrolment and management flows spanning TOTP and recovery codes"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth.recovery_codes import delete_recovery_codes, generate_recovery_codes, has_recovery_codes
from app.services.auth.step_up import verify_step_up
from app.services.auth.totp import disable_totp, is_pending_totp_code_valid, is_totp_enabled, mark_totp_confirmed

# Shared message so disabling and regenerating reject identically when 2FA is off
_NOT_ENABLED_DETAIL = "Two-factor authentication is not enabled"


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
