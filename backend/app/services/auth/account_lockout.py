"""Sign-in lockout shared by the password and second-factor login steps, counted per email

The count belongs to the email a sign-in names, not to an account, so an address nobody registered
locks after the same number of failures and answers the same way as a registered one. Otherwise the
lock would show which addresses have an account
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import and_, case, delete, func, select, update
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
    """Return whether the email is inside an active lockout window, without counting an attempt

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not

    Returns:
        Whether the lockout window is still active
    """
    locked_until = await db.scalar(select(LoginLockout.locked_until).where(LoginLockout.email_hash == seal_login_email(email)))
    return bool(locked_until and locked_until > datetime.now(UTC))


async def claim_attempt(db: AsyncSession, email: str) -> int:
    """Count an authentication attempt before its password or code is checked

    Password and second-factor attempts share this counter, so a known password cannot grind the second
    factor without tripping the same lock. The attempt is counted and committed before anything is
    checked, so simultaneous attempts each take their own place in the count and no more than the limit
    of wrong answers can be given before the lock holds, however they overlap. A right answer gives its
    place back, so it never counts against the limit. An attempt that finds the email locked changes nothing and
    is refused. The caller then reports a wrong answer through confirm_failed_attempt, or gives the place
    back through release_attempt when the attempt proves nothing wrong

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not

    Returns:
        The number of attempts left before the email locks, zero once this one has taken the last place

    Raises:
        HTTPException: The email is locked, so nothing may be checked
    """
    now = datetime.now(UTC)
    lock_deadline = now + timedelta(minutes=_LOCKOUT_MINUTES)

    lock_active = and_(LoginLockout.locked_until.is_not(None), LoginLockout.locked_until > now)

    # A lock that has already expired starts a fresh count, so waiting out the window restores the full
    # allowance instead of leaving the email one failure away from re-locking
    lock_expired = and_(LoginLockout.locked_until.is_not(None), LoginLockout.locked_until <= now)
    next_count = case((lock_active, LoginLockout.failed_attempt_count), (lock_expired, 1), else_=LoginLockout.failed_attempt_count + 1)

    # Insert or increment in one row-locked statement keyed off the stored value, not a Python
    # read-modify-write, so concurrent attempts each advance the counter by exactly one instead of
    # reading the same count and clobbering each other. The conflict branch has no WHERE, so a locked
    # email still gets its row back, with the count and the stamp left as they were
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
                    (lock_active, LoginLockout.locked_until),
                    (next_count >= _MAX_FAILED_ATTEMPTS, lock_deadline),
                    (lock_expired, None),
                    else_=LoginLockout.locked_until,
                ),
                "last_failed_at": case((lock_active, LoginLockout.last_failed_at), else_=now),
            },
        )
        .returning(LoginLockout.failed_attempt_count, LoginLockout.last_failed_at)
    )
    count, stamped_at = result.one()

    # Only a counted attempt stamps this call's own instant, so any other stamp means the lock was
    # already active when the statement ran
    if stamped_at != now:
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")
    await db.commit()

    return max(0, _MAX_FAILED_ATTEMPTS - count)


async def confirm_failed_attempt(db: AsyncSession, user_id: uuid.UUID | None, remaining: int) -> None:
    """Finish a claimed attempt whose password or code was wrong

    The attempt that took the last place has locked the email, and that also revokes every session of
    the account the email belongs to, so a grinder who already holds a token cannot keep using it while
    the account is locked. An email with no account has no sessions to revoke. Earlier attempts need
    nothing more, since claiming already counted them

    Args:
        db: Active database session
        user_id: The account with that email, or None when no account has it
        remaining: What claim_attempt returned for this attempt
    """
    if remaining == 0 and user_id is not None:
        await delete_all_user_auth_sessions(db, user_id)
    await db.commit()


async def release_attempt(db: AsyncSession, email: str) -> None:
    """Give a claimed attempt back when it turned out not to be a failure

    A correct password that still needs a second factor, or a passkey ceremony that expired or was
    fumbled, is not a wrong guess, so it must not use up the allowance. The count never drops below
    zero, and any lock is lifted, since only an attempt that held a place can release one and a claim is
    refused while the lock is set

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not
    """
    await db.execute(
        update(LoginLockout)
        .where(LoginLockout.email_hash == seal_login_email(email))
        .values(failed_attempt_count=func.greatest(LoginLockout.failed_attempt_count - 1, 0), locked_until=None)
    )
    await db.commit()


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
