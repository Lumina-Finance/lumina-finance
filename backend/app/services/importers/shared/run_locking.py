"""Holding an import run, or the user's change marker, while one request works on it"""

import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cache_state import UserCacheState
from app.models.import_run import ImportRun

# Postgres raises this for a lock the caller waited out
_LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"

# How long a request waits for the run before giving up on it. Long enough to sit through a batch
# of rows being staged, which is what a request arriving behind another usually waits for, and
# short enough that a commit writing a whole file does not hold a pooled connection behind it
RUN_LOCK_WAIT = "10s"


async def load_locked_run(db: AsyncSession, run_id: uuid.UUID) -> ImportRun | None:
    """Load a run and hold it for the rest of the transaction

    Every request that changes a run takes this, so staging, committing and dropping one cannot
    interleave

    Args:
        db: Active database session
        run_id: Run to load

    Returns:
        The run, held for the rest of the transaction, or None when there is no such run of the
        caller's, whether it never existed or another request has already dropped it

    Raises:
        HTTPException: Raised with 409 when another request holds the run for longer than the wait
    """
    # Bounded for this statement alone. The setting lasts the whole transaction, so leaving it in
    # place would put the same bound on every lock the commit takes afterwards, and a wait on one
    # of those would come back as an error this does not answer for
    await db.execute(text(f"SET LOCAL lock_timeout = '{RUN_LOCK_WAIT}'"))
    query = select(ImportRun).where(ImportRun.id == run_id).with_for_update()

    try:
        run = (await db.execute(query)).scalar_one_or_none()
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) != _LOCK_NOT_AVAILABLE_SQLSTATE:
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This import is already being worked on",
        ) from exc

    await db.execute(text("SET LOCAL lock_timeout = DEFAULT"))
    return run


async def load_locked_change_marker(db: AsyncSession, user_id: uuid.UUID) -> datetime | None:
    """Read when the user's data last changed, holding that marker for the rest of the transaction

    Every write to the user's data moves the marker as it finishes, so while it is held no other
    change can land, and one already landed shows as a later time

    Args:
        db: Active database session
        user_id: User whose marker is read

    Returns:
        When their data last changed, or None when it never has

    Raises:
        HTTPException: Raised with 409 when another change holds the marker for longer than the wait
    """
    await db.execute(text(f"SET LOCAL lock_timeout = '{RUN_LOCK_WAIT}'"))
    query = select(UserCacheState.changed_at).where(UserCacheState.user_id == user_id).with_for_update()

    try:
        changed_at = (await db.execute(query)).scalar_one_or_none()
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) != _LOCK_NOT_AVAILABLE_SQLSTATE:
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This import can no longer be undone",
        ) from exc

    await db.execute(text("SET LOCAL lock_timeout = DEFAULT"))
    return changed_at
