"""Account lockout shared by the password and second-factor login steps"""
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordCredential
from app.services.auth.sessions import delete_all_user_auth_sessions

_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_MINUTES = 30


async def get_password_credential(db: AsyncSession, user_id: uuid.UUID) -> PasswordCredential | None:
    """Return the user's password credential, the row that carries the lockout counters

    Args:
        db: Active database session
        user_id: User whose credential is loaded

    Returns:
        Password credential row when the user has password auth enabled
    """
    result = await db.execute(select(PasswordCredential).where(PasswordCredential.user_id == user_id))
    return result.scalar_one_or_none()


def is_account_locked(credential: PasswordCredential) -> bool:
    """Return whether the credential is inside an active lockout window

    Args:
        credential: Password credential to inspect

    Returns:
        Whether the lockout window is still active
    """
    return bool(credential.locked_until and credential.locked_until > datetime.now(UTC))


async def record_failed_attempt(db: AsyncSession, credential: PasswordCredential) -> None:
    """Count a failed authentication attempt and lock the account once the limit is reached

    Password and second-factor failures share this counter, so a known password cannot grind the
    second factor without tripping the same lock. Tripping the lock also revokes every session, so a
    grinder who already holds a token cannot keep using it while the account is locked. The caller's
    surrounding commit persists it

    Args:
        db: Active database session
        credential: Password credential receiving the failed attempt
    """
    credential.failed_attempt_count += 1
    if credential.failed_attempt_count >= _MAX_FAILED_ATTEMPTS:
        credential.locked_until = datetime.now(UTC) + timedelta(minutes=_LOCKOUT_MINUTES)
        await delete_all_user_auth_sessions(db, credential.user_id)
    await db.commit()


async def reset_failed_attempts(db: AsyncSession, credential: PasswordCredential) -> None:
    """Clear the lockout counters once a login fully completes, including any second factor

    Args:
        db: Active database session
        credential: Password credential for the completed login
    """
    credential.failed_attempt_count = 0
    credential.locked_until = None
    await db.commit()
