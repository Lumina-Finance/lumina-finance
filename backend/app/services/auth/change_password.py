"""Change-password service"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordCredential
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest
from app.services.auth.password_helpers import hash_password, is_password_valid
from app.services.auth.sessions import delete_other_user_auth_sessions
from app.services.auth.totp import is_totp_enabled, is_user_totp_code_valid


async def change_password(
    db: AsyncSession,
    user: User,
    current_session_id: uuid.UUID,
    data: ChangePasswordRequest,
) -> None:
    """Replace an authenticated user's password after verifying the current one

    Args:
        db: Active database session
        user: Authenticated user changing their password
        current_session_id: Session that made the request and stays signed in
        data: Current and new password payload

    Raises:
        HTTPException: The current password is missing or incorrect
    """
    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == user.id)

    # Scope the lookup to the caller since password credentials carry no row-level policy
    result = await db.execute(credential_query)
    credential = result.scalar_one_or_none()
    if not credential or not is_password_valid(data.current_password, credential.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # A password change re-verifies the authenticator when two-factor is enabled, and only a TOTP
    # code, never a recovery code, since recovery codes are a login-only break-glass
    if await is_totp_enabled(db, user.id) and (
        not data.code or not await is_user_totp_code_valid(db, user.id, data.code)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid two-factor code")

    # A verified change clears any login lockout since the caller has proven the current password
    credential.password_hash = hash_password(data.new_password)
    credential.password_algo = "argon2id"  # noqa: S105
    credential.failed_attempt_count = 0
    credential.locked_until = None

    # Sign the user out of every other device so a leaked password cannot keep one authenticated
    await delete_other_user_auth_sessions(db, user.id, current_session_id)
    await db.commit()
