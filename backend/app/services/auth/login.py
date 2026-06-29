"""Login service"""
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import current_user_id_ctx
from app.models.user import User
from app.schemas.auth import LoginRequest
from app.services.auth.account_lockout import (
    get_password_credential,
    is_account_locked,
    record_failed_attempt,
)
from app.services.auth.password_helpers import hash_dummy_password_for_timing, is_password_valid
from app.services.auth.user_lookup import find_user_id_by_email


async def login(db: AsyncSession, data: LoginRequest) -> User:
    """Verify the password step of login and enforce account lockout

    The lockout counter is not reset here. A login is only complete once any required second factor
    also passes, so the reset belongs to that final step, otherwise a correct password alone could
    clear a second-factor lockout and the authenticator could be ground

    Args:
        db: Active database session
        data: Login payload with email and password

    Returns:
        Authenticated user

    Raises:
        HTTPException: Credentials are invalid or the account is temporarily locked
    """
    user_id = await find_user_id_by_email(db, data.email)
    if not user_id:
        hash_dummy_password_for_timing()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    credential = await get_password_credential(db, user_id)
    if not credential:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if is_account_locked(credential):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")

    if not is_password_valid(data.password, credential.password_hash):
        await record_failed_attempt(db, credential)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # The email and credential lookups ran before any identity existed, so close that transaction
    # and adopt the verified identity, so loading the user re-stamps it for the self-only users policy
    current_user_id_ctx.set(user_id)
    await db.commit()
    user = await db.get(User, user_id)
    return user
