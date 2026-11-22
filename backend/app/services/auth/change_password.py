"""Change-password service"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models.user import User
from app.schemas.auth import ChangePasswordRequest
from app.services.auth.account_lockout import get_password_credential, reset_all_failed_attempts
from app.services.auth.password_helpers import hash_password
from app.services.auth.sessions import delete_other_user_auth_sessions
from app.services.auth.step_up import verify_sensitive_action_step_up


async def change_password(
    db: AsyncSession,
    user: User,
    current_session_id: uuid.UUID,
    data: ChangePasswordRequest,
) -> None:
    """Replace an authenticated user's password after re-verifying who they are

    A password change is a sensitive account change, so when any second factor is active it steps up
    with the current password plus a current factor, a passkey or a TOTP code, counted in the session's
    lockout. With no factor set up the current password alone gates it. The caller commits

    Args:
        db: Active database session
        user: Authenticated user changing their password
        current_session_id: Session that made the request and stays signed in
        data: Current and new password payload, with an optional second factor

    Raises:
        HTTPException: The session's step-up is locked, the current password is wrong, or a required second
            factor is missing or does not verify
    """
    credential = await get_password_credential(db, user.id)
    if credential is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    await verify_sensitive_action_step_up(db, user, data.current_password, code=data.code, passkey=data.passkey)

    # The step-up only clears its own session's count, but a changed password proves its owner is here,
    # so no bucket of the email keeps a lock earned against the old one
    await reset_all_failed_attempts(db, user.email)
    credential.password_hash = await run_in_threadpool(hash_password, data.new_password)
    credential.password_algo = "argon2id"  # noqa: S105

    # Sign the user out of every other device so a leaked password cannot keep one authenticated
    await delete_other_user_auth_sessions(db, user.id, current_session_id)
    await db.commit()
