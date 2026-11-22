"""Sign-in lockout shared by the password and second-factor login steps, counted per email and bucket

The count belongs to the email a sign-in names, not to an account, so an address nobody registered
locks after the same number of failures and answers the same way as a registered one. Otherwise the
lock would show which addresses have an account

Within an email, who sent the attempt picks the bucket it counts in (known_browser.py), and each bucket
counts and locks on its own. Failures from a browser the address has signed in from, and failures of
one session stepping up, lock their bucket and end every session of the account, since the sender may
hold a stolen session. Failures from anyone else share one bucket that locks for the same time and
ends nothing, so a stranger guessing an address's password can delay sign-ins but never sign its
owner out
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, and_, case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import LoginLockout, PasswordCredential
from app.services.auth.known_browser import SHARED_BUCKET
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


def _bucket_row(email: str, bucket: str) -> ColumnElement[bool]:
    """Return the condition selecting the one record an email has in a bucket"""
    return and_(LoginLockout.email_hash == seal_login_email(email), LoginLockout.bucket_hash == bucket)


async def is_email_locked(db: AsyncSession, email: str, bucket: str) -> bool:
    """Return whether the email is inside an active lockout window in the bucket, without counting an attempt

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not
        bucket: Where the attempt counts, from known_browser.py

    Returns:
        Whether the lockout window is still active
    """
    locked_until = await db.scalar(select(LoginLockout.locked_until).where(_bucket_row(email, bucket)))
    return bool(locked_until and locked_until > datetime.now(UTC))


async def claim_attempt(db: AsyncSession, email: str, bucket: str) -> int:
    """Count an authentication attempt before its password or code is checked

    Password and second-factor attempts share this counter, so a known password cannot grind the second
    factor without tripping the same lock. The attempt is counted and committed before anything is
    checked, so simultaneous attempts each take their own place in the count and no more than the limit
    of wrong answers can be given before the lock holds, however they overlap. A right answer gives its
    place back, so it never counts against the limit. An attempt that finds the bucket locked changes nothing and
    is refused. The caller then reports a wrong answer through confirm_failed_attempt, or gives the place
    back through release_attempt when the attempt proves nothing wrong

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not
        bucket: Where the attempt counts, from known_browser.py

    Returns:
        The number of attempts left before the bucket locks, zero once this one has taken the last place

    Raises:
        HTTPException: The bucket is locked, so nothing may be checked
    """
    now = datetime.now(UTC)
    lock_deadline = now + timedelta(minutes=_LOCKOUT_MINUTES)

    lock_active = and_(LoginLockout.locked_until.is_not(None), LoginLockout.locked_until > now)

    # A lock that has already expired starts a fresh count, so waiting out the window restores the full
    # allowance instead of leaving the bucket one failure away from re-locking
    lock_expired = and_(LoginLockout.locked_until.is_not(None), LoginLockout.locked_until <= now)
    next_count = case((lock_active, LoginLockout.failed_attempt_count), (lock_expired, 1), else_=LoginLockout.failed_attempt_count + 1)

    # Insert or increment in one row-locked statement keyed off the stored value, not a Python
    # read-modify-write, so concurrent attempts each advance the counter by exactly one instead of
    # reading the same count and clobbering each other. The conflict branch has no WHERE, so a locked
    # bucket still gets its row back, with the count and the stamp left as they were
    result = await db.execute(
        insert(LoginLockout)
        .values(
            email_hash=seal_login_email(email),
            bucket_hash=bucket,
            failed_attempt_count=1,
            locked_until=None,
            last_failed_at=now,
        )
        .on_conflict_do_update(
            index_elements=[LoginLockout.email_hash, LoginLockout.bucket_hash],
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


async def confirm_failed_attempt(db: AsyncSession, user_id: uuid.UUID | None, remaining: int, bucket: str) -> None:
    """Finish a claimed attempt whose password or code was wrong

    The attempt that took the last place has locked the bucket. A lock on a known browser or a session
    also revokes every session of the account the email belongs to, so a grinder who already holds a
    token cannot keep using it. The shared bucket revokes nothing, since the strangers counted there
    hold no session and an owner must not be signed out by them. An email with no account has no
    sessions to revoke. Earlier attempts need nothing more, since claiming already counted them

    Args:
        db: Active database session
        user_id: The account with that email, or None when no account has it
        remaining: What claim_attempt returned for this attempt
        bucket: The bucket the attempt was claimed in
    """
    if remaining == 0 and user_id is not None and bucket != SHARED_BUCKET:
        await delete_all_user_auth_sessions(db, user_id)
    await db.commit()


async def release_attempt(db: AsyncSession, email: str, bucket: str) -> None:
    """Give a claimed attempt back when it turned out not to be a failure

    A correct password that still needs a second factor, or a passkey ceremony that expired or was
    fumbled, is not a wrong guess, so it must not use up the allowance. The count never drops below
    zero, and any lock is lifted, since only an attempt that held a place can release one and a claim is
    refused while the lock is set

    Args:
        db: Active database session
        email: Address the sign-in names, registered or not
        bucket: The bucket the attempt was claimed in
    """
    await db.execute(
        update(LoginLockout)
        .where(_bucket_row(email, bucket))
        .values(failed_attempt_count=func.greatest(LoginLockout.failed_attempt_count - 1, 0), locked_until=None)
    )
    await db.commit()


async def reset_failed_attempts(db: AsyncSession, email: str, bucket: str) -> None:
    """Forget the bucket's failures once a login fully completes, including any second factor

    Only the bucket the sign-in counted in is cleared, so finishing a sign-in from one browser never
    lifts a lock another sender earned. The caller commits

    Args:
        db: Active database session
        email: Address of the account that completed the login or proved its password
        bucket: The bucket the sign-in counted in
    """
    await db.execute(delete(LoginLockout).where(_bucket_row(email, bucket)))


async def reset_all_failed_attempts(db: AsyncSession, email: str) -> None:
    """Forget the failures of every bucket of an email

    For a change that proves the owner holds the address or the password, such as a reset or a changed
    password, after which every lock earned against the old state no longer applies. The caller commits

    Args:
        db: Active database session
        email: Address whose failures are forgotten
    """
    await db.execute(delete(LoginLockout).where(LoginLockout.email_hash == seal_login_email(email)))


async def delete_idle_login_lockouts(db: AsyncSession) -> None:
    """Delete lockout rows nobody has added a failure to within the retention window

    Args:
        db: Active database session
    """
    await db.execute(delete(LoginLockout).where(LoginLockout.last_failed_at < datetime.now(UTC) - _IDLE_RETENTION))
