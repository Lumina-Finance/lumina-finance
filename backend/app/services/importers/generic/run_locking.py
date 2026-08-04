"""Holding an import run while one request works on it"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun

# Postgres raises this when a row wanted for update is held by another transaction
_LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"


async def load_locked_run(db: AsyncSession, run_id: uuid.UUID) -> ImportRun | None:
    """Load a run and hold it for the rest of the transaction

    Every request that changes a run takes this, so staging, committing and dropping one cannot
    interleave. A run another request already holds is refused rather than queued behind it, since
    waiting would hold a pooled connection for as long as the import in front of it takes

    Args:
        db: Active database session
        run_id: Run to load

    Returns:
        The run, held for the rest of the transaction, or None when it is not the caller's

    Raises:
        HTTPException: Raised with 409 when another request already holds the run
    """
    query = select(ImportRun).where(ImportRun.id == run_id).with_for_update(nowait=True)

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
