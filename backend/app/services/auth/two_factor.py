"""Two-factor enrolment flows spanning TOTP and recovery codes"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.auth.recovery_codes import generate_recovery_codes
from app.services.auth.totp import confirm_totp_setup


async def confirm_totp_enrollment(db: AsyncSession, user_id: uuid.UUID, code: str) -> list[str]:
    """Confirm a pending TOTP secret and issue the first recovery code batch

    Confirmation and recovery code generation share one transaction so two-factor only turns on
    together with usable recovery codes

    Args:
        db: Active database session
        user_id: User confirming enrolment
        code: Code from the authenticator app

    Returns:
        The plaintext recovery codes to show once

    Raises:
        HTTPException: No pending setup exists or the code is invalid
    """
    if not await confirm_totp_setup(db, user_id, code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    codes = await generate_recovery_codes(db, user_id)
    await db.commit()
    return codes
