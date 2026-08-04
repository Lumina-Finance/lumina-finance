"""Holding an import run while one request works on it"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun

# Postgres raises this both for a lock refused outright and for one waited out
_LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"

# How long a request waits for the run before giving up on it. Long enough to sit through a batch
# of rows being staged, which is what a request racing the one in front of it usually waits for,
# and short enough that a commit writing a whole file does not hold a pooled connection behind it
_RUN_LOCK_WAIT = "3s"


async def load_locked_run(db: AsyncSession, run_id: uuid.UUID) -> ImportRun | None:
    """Load a run and hold it for the rest of the transaction

    Every request that changes a run takes this, so staging, committing and dropping one cannot
    interleave

    Args:
        db: Active database session
        run_id: Run to load

    Returns:
        The run, held for the rest of the transaction, or None when it is not the caller's

    Raises:
        HTTPException: Raised with 409 when another request holds the run for longer than the wait
    """
    await db.execute(text(f"SET LOCAL lock_timeout = '{_RUN_LOCK_WAIT}'"))
    query = select(ImportRun).where(ImportRun.id == run_id).with_for_update()

    try:
        return (await db.execute(query)).scalar_one_or_none()
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) != _LOCK_NOT_AVAILABLE_SQLSTATE:
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This import is already being worked on",
        ) from exc
