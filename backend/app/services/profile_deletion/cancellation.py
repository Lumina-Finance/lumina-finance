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

    Args:
        db: Active database session, acting as the user
        user: The user whose deletion is cancelled

    A profile with no mark is left as it is and returned, so a second tab cancelling after the first
    gets the same answer

    Returns:
        The user, with no mark

    Raises:
        HTTPException 409: The user row is gone, or the wait has ended
    """
    locked = await db.scalar(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))
    if locked is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your profile is not waiting to be deleted")

    # Another tab may have cancelled already, so there is nothing to clear and the answer is the same user
    if locked.deletion_requested_at is None:
        return locked

    # The lock comes first, then the clock is read in a statement of its own, so the due time is
    # compared with the time once the lock is held. A mark with no due time goes at once
    if locked.deletion_due_at is None or locked.deletion_due_at <= await db.scalar(select(func.clock_timestamp())):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your profile is already being deleted, so the deletion can no longer be cancelled",
        )

    locked.deletion_requested_at = None
    locked.deletion_due_at = None
    locked.deletion_reminder_sent_at = None
    await db.flush()
    await db.commit()
    await db.refresh(locked)
    return locked
