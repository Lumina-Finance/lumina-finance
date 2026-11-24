"""Cancelling a waiting profile deletion"""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def cancel_profile_deletion(db: AsyncSession, user: User) -> User:
    """Take the mark off a profile whose deletion is still waiting, as one unit of work

    The user row is locked and its due time read against the database's own clock, the clock the deletion
    run's lock reads, so the two never both succeed. A cancel that gets the lock first clears the mark and
    the run finds nothing to delete. One that gets it after the run has started finds the due time passed
    and is refused, so a profile is never left half deleted but still its owner's. Bank sync resumes on
    its own, since the connections were never touched

    A profile with no mark is left as it is and returned

    Args:
        db: Active database session, acting as the user
        user: The user whose deletion is cancelled

    Returns:
        The user, with no mark

    Raises:
        HTTPException 409: The deletion has begun, so the profile can no longer be cancelled
    """
    too_late = HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Your profile is already being deleted, so the deletion can no longer be cancelled",
    )
    locked = await db.scalar(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))
    # The row is gone when the cancel waited on the lock while the run deleted the profile
    if locked is None:
        raise too_late

    # Nothing to clear when the profile has no mark
    if locked.deletion_requested_at is None:
        return locked

    # A statement that waited for the lock keeps the time it read before waiting, so the clock is read in a
    # statement of its own once the lock is held. A mark with no due time goes at once
    if locked.deletion_due_at is None or locked.deletion_due_at <= await db.scalar(select(func.clock_timestamp())):
        raise too_late

    locked.deletion_requested_at = None
    locked.deletion_due_at = None
    locked.deletion_reminder_sent_at = None
    await db.flush()
    await db.commit()
    await db.refresh(locked)
    return locked
