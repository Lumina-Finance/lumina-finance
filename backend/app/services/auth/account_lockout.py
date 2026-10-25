"""Sign-in lockout shared by the password and second-factor login steps, counted per email

The count belongs to the email a sign-in names, not to an account, so an address nobody registered
locks after the same number of failures and answers the same way as a registered one. Otherwise the
lock would show which addresses have an account
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import LoginLockout, PasswordCredential
from app.services.auth.login_email_hash import seal_login_email
from app.services.auth.sessions import delete_all_user_auth_sessions

_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_MINUTES = 30

# A count nobody has added to for this long is forgotten. Addresses nobody registered never sign in,
# so nothing else would clear their rows, and anonymous requests could otherwise grow the table forever
_IDLE_RETENTION = timedelta(days=7)


async def get_password_credential(db: AsyncSession, user_id: uuid.UUID) -> PasswordCredential | None:
    """Return the user's password credential

    Args:
        db: Active database session
        user_id: User whose credential is loaded

    Returns:
        Password credential row when the user has password auth enabled
    """
    result = await db.execute(select(PasswordCredential).where(PasswordCredential.user_id == user_id))
    return result.scalar_one_or_none()


async def is_email_locked(db: AsyncSession, email: str) -> bool:
    """Return whether the email is inside an active lockout window

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not

    Returns:
        Whether the lockout window is still active
    """
    locked_until = await db.scalar(select(LoginLockout.locked_until).where(LoginLockout.email_hash == seal_login_email(email)))
    return bool(locked_until and locked_until > datetime.now(UTC))


async def record_failed_attempt(db: AsyncSession, email: str, user_id: uuid.UUID | None) -> int:
    """Count a failed authentication attempt and lock the email once the limit is reached

    Password and second-factor failures share this counter, so a known password cannot grind the
    second factor without tripping the same lock. Tripping the lock also revokes every session of the
    account the email belongs to, so a grinder who already holds a token cannot keep using it while the
    account is locked. The caller's surrounding commit persists it

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not
        user_id: The account with that email, or None when no account has it

    Returns:
        The number of attempts left before the email locks, zero once this failure has locked it
    """
    now = datetime.now(UTC)
    lock_deadline = now + timedelta(minutes=_LOCKOUT_MINUTES)

    # A lock that has already expired starts a fresh count, so waiting out the window restores the full
    # allowance instead of leaving the email one failure away from re-locking
    lock_expired = and_(LoginLockout.locked_until.is_not(None), LoginLockout.locked_until <= now)
    next_count = case((lock_expired, 1), else_=LoginLockout.failed_attempt_count + 1)

    # Insert or increment in one row-locked statement keyed off the stored value, not a Python
    # read-modify-write, so concurrent failures each advance the counter by exactly one instead of
    # reading the same count and clobbering each other, which would let a burst of guesses slip past
    # the lock. The first failure for an email creates its row
    result = await db.execute(
        insert(LoginLockout)
        .values(
            email_hash=seal_login_email(email),
            failed_attempt_count=1,
            locked_until=None,
            last_failed_at=now,
        )
        .on_conflict_do_update(
            index_elements=[LoginLockout.email_hash],
            set_={
                "failed_attempt_count": next_count,
                "locked_until": case(
                    (next_count >= _MAX_FAILED_ATTEMPTS, lock_deadline),
                    (lock_expired, None),
                    else_=LoginLockout.locked_until,
                ),
                "last_failed_at": now,
            },
        )
        .returning(LoginLockout.failed_attempt_count)
    )
    new_count = result.scalar_one()

    # Revoking every session is a separate write, so it runs only when this failure reached the limit,
    # keyed off the authoritative count the atomic statement returned. An email with no account has
    # no sessions to revoke
    if new_count >= _MAX_FAILED_ATTEMPTS and user_id is not None:
        await delete_all_user_auth_sessions(db, user_id)
    await db.commit()

    return max(0, _MAX_FAILED_ATTEMPTS - new_count)


async def reset_failed_attempts(db: AsyncSession, email: str) -> None:
    """Forget the email's failures once a login fully completes, including any second factor

    The caller commits

    Args:
        db: Active database session
        email: Address of the account that completed the login or proved its password
    """
    await db.execute(delete(LoginLockout).where(LoginLockout.email_hash == seal_login_email(email)))


async def delete_idle_login_lockouts(db: AsyncSession) -> None:
    """Delete lockout rows nobody has added a failure to within the retention window

    Args:
        db: Active database session
    """
    await db.execute(delete(LoginLockout).where(LoginLockout.last_failed_at < datetime.now(UTC) - _IDLE_RETENTION))
