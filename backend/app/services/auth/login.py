"""Login service"""
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import current_user_id_ctx
from app.models.auth import PasswordCredential
from app.models.user import User
from app.schemas.auth import LoginRequest
from app.services.auth.password_helpers import hash_dummy_password_for_timing, is_password_valid
from app.services.auth.user_lookup import find_user_id_by_email

_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_MINUTES = 30


async def login(db: AsyncSession, data: LoginRequest) -> User:
    """Authenticate a user by email and password

    Verifies password credentials and enforces account lockout after repeated
    failed attempts

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

    credential = await _get_password_credential(db, user_id)
    if not credential:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if _is_credential_locked(credential):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")

    if not is_password_valid(data.password, credential.password_hash):
        await _record_failed_login(db, credential)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    await _reset_failed_login(db, credential)

    # The password is verified, so adopt the user's identity and load their row through
    # the normal self-only users policy rather than a definer that bypasses it
    current_user_id_ctx.set(user_id)
    user = await db.get(User, user_id)
    return user


async def _get_password_credential(db: AsyncSession, user_id: uuid.UUID) -> PasswordCredential | None:
    """Return the password credential for a user

    Args:
        db: Active database session
        user_id: User identifier that owns the password credential

    Returns:
        Password credential row when the user has password auth enabled
    """
    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == user_id)

    # Fetch the password credential separately so missing credentials receive the same invalid response
    result = await db.execute(credential_query)
    credential = result.scalar_one_or_none()
    return credential


def _is_credential_locked(credential: PasswordCredential) -> bool:
    """Return whether a password credential is currently locked

    Args:
        credential: Password credential to inspect

    Returns:
        Whether the lockout window is still active
    """
    is_locked = bool(credential.locked_until and credential.locked_until > datetime.now(UTC))
    return is_locked


async def _record_failed_login(db: AsyncSession, credential: PasswordCredential) -> None:
    """Record a failed password login attempt and lock when needed

    Args:
        db: Active database session
        credential: Password credential receiving the failed attempt
    """
    credential.failed_attempt_count += 1
    if credential.failed_attempt_count >= _MAX_FAILED_ATTEMPTS:
        credential.locked_until = datetime.now(UTC) + timedelta(minutes=_LOCKOUT_MINUTES)
    await db.commit()


async def _reset_failed_login(db: AsyncSession, credential: PasswordCredential) -> None:
    """Clear failed login counters after a successful login

    Args:
        db: Active database session
        credential: Password credential for the successful login
    """
    credential.failed_attempt_count = 0
    credential.locked_until = None
    await db.commit()
