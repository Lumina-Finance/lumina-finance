"""Commit steps every import run shares, whichever importer opened it"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun, ImportRunSource, ImportStagedRow
from app.services.importers.shared.run_locking import load_locked_run
from app.services.importers.shared.run_staging import require_run_source


async def lock_run_for_commit(db: AsyncSession, run_id: uuid.UUID, source: ImportRunSource) -> ImportRun:
    """Return the caller's run, held until this transaction ends

    The row-level security policy is what scopes this to the caller, so another user's run is
    absent rather than refused

    Args:
        db: Active database session
        run_id: Run to load
        source: Importer whose commit is asking, which must be the one that opened the run

    Returns:
        The run, held for the rest of the transaction

    Raises:
        HTTPException: Raised with 404 when there is no such run of the caller's, 409 when
            another request already holds it, and 422 when another importer opened it
    """
    run = await load_locked_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found")
    require_run_source(run, source)
    return run


async def get_every_staged_row(db: AsyncSession, run: ImportRun) -> list[ImportStagedRow]:
    """Return a run's staged rows in the order they appeared in the file, once all have arrived

    Args:
        db: Active database session
        run: Run being committed

    Returns:
        Staged rows ordered by their position in the file

    Raises:
        HTTPException: Raised with 422 when the staged rows do not add up to the file the run declared
    """
    # Ordered by position so the import reads the file as the user sees it, whatever order the
    # batches carrying it arrived in
    query = select(ImportStagedRow).where(ImportStagedRow.import_run_id == run.id).order_by(ImportStagedRow.row_index)
    rows = list((await db.execute(query)).scalars().all())

    if len(rows) != run.expected_transaction_count:
        # A run is opened for a fixed number of rows, so a batch that never arrived can never be
        # supplied to this one. Refusing it as the file's own fault rather than as a clash is what
        # stops the page offering a second attempt that would answer the same way
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This import has {len(rows)} of its {run.expected_transaction_count} rows staged",
        )
    return rows


async def finish_run_commit(db: AsyncSession, run: ImportRun, summary: BaseModel) -> None:
    """Clear what a run staged and record its summary, committing everything the run wrote

    The staged copy has served its purpose once the rows are in the ledger, and it goes in the
    same transaction as the rows so neither can outlive the other

    Args:
        db: Active database session
        run: Run whose records have been written
        summary: Response the commit returns, kept so a repeated commit answers the same

    Returns:
        None
    """
    await db.execute(delete(ImportStagedRow).where(ImportStagedRow.import_run_id == run.id))
    run.committed_at = datetime.now(UTC)
    run.summary = summary.model_dump(mode="json")
    await db.commit()
