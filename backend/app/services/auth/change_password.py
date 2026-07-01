"""Change-password service"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.auth import ChangePasswordRequest
from app.services.auth.account_lockout import get_password_credential
from app.services.auth.password_helpers import hash_password, is_password_valid
from app.services.auth.sessions import delete_other_user_auth_sessions
from app.services.auth.step_up import verify_step_up
from app.services.auth.totp import is_totp_enabled
from app.services.auth.webauthn import is_passkey_registered


async def change_password(
    db: AsyncSession,
    user: User,
    current_session_id: uuid.UUID,
    data: ChangePasswordRequest,
) -> None:
    """Replace an authenticated user's password after re-verifying who they are

    A password change is a sensitive account change, so when any second factor is active it steps up
    with the current password plus a current factor, a passkey or a TOTP code, sharing the login
    lockout. With no factor set up the current password alone gates it. The caller commits

    Args:
        db: Active database session
        user: Authenticated user changing their password
        current_session_id: Session that made the request and stays signed in
        data: Current and new password payload, with an optional second factor

    Raises:
        HTTPException: The account is locked, the current password is wrong, or a required second
            factor is missing or does not verify
    """
    credential = await get_password_credential(db, user.id)
    if credential is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if await is_totp_enabled(db, user.id) or await is_passkey_registered(db, user.id):
        await verify_step_up(db, user, data.current_password, code=data.code, passkey=data.passkey)
    elif not is_password_valid(data.current_password, credential.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # A verified change clears any login lockout since the caller has proven the current password
    credential.password_hash = hash_password(data.new_password)
    credential.password_algo = "argon2id"  # noqa: S105
    credential.failed_attempt_count = 0
    credential.locked_until = None

    # Sign the user out of every other device so a leaked password cannot keep one authenticated
    await delete_other_user_auth_sessions(db, user.id, current_session_id)
    await db.commit()
