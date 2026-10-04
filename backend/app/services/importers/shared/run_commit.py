"""Commit steps every import run shares, whichever importer opened it"""

import uuid
from collections.abc import Awaitable, Callable, Collection
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun, ImportRunSource, ImportStagedRow
from app.services.importers.shared.run_locking import load_locked_run
from app.services.importers.shared.run_staging import is_run_abandoned, require_run_source


async def commit_run[Summary: BaseModel](
    db: AsyncSession,
    run_id: uuid.UUID,
    sources: Collection[ImportRunSource],
    summary_type: type[Summary],
    write_run: Callable[[ImportRun, list[ImportStagedRow]], Awaitable[Summary]],
) -> Summary:
    """Write a staged run into the ledger, in one transaction with clearing what it staged

    A run already committed answers with the summary it returned the first time, so a commit whose
    response was lost can be repeated without importing the file twice

    Args:
        db: Active database session
        run_id: Run to commit
        sources: Importers whose runs the asking commit writes, one of which must have opened the run
        summary_type: The summary the importer returns, which a repeated commit is answered with
        write_run: The importer's own writing, given the run and its staged rows in file order and
            returning the summary, without committing

    Returns:
        The summary of what the commit wrote

    Raises:
        HTTPException: Raised with 404 for a run that is absent or not the caller's, 409 when
            another request holds the run, and 422 when an importer outside the sources opened the
            run, when it was abandoned before it was committed, or when the staged rows do not add
            up to the file the run declared. The importer's writing raises its own refusals
    """
    run = await _lock_run_for_commit(db, run_id, sources)
    if run.committed_at is not None:
        return summary_type.model_validate(run.summary)

    rows = await _get_every_staged_row(db, run)
    summary = await write_run(run, rows)
    await _finish_run_commit(db, run, summary)
    return summary


async def _lock_run_for_commit(db: AsyncSession, run_id: uuid.UUID, sources: Collection[ImportRunSource]) -> ImportRun:
    """Return the caller's run, held until this transaction ends

    The row-level security policy is what scopes this to the caller, so another user's run is
    absent rather than refused

    Args:
        db: Active database session
        run_id: Run to load
        sources: Importers whose runs the asking commit writes, one of which must have opened the run

    Returns:
        The run, held for the rest of the transaction

    Raises:
        HTTPException: Raised with 404 when there is no such run of the caller's, 409 when
            another request already holds it, and 422 when an importer outside the sources opened it
            or the run was abandoned before it was committed
    """
    run = await load_locked_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found")
    require_run_source(run, sources)

    # Refused rather than written, so an import its user has since brought in again cannot land a
    # second time. The page reads the refusal as nothing written, which is true
    if is_run_abandoned(run):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="This import expired before it was saved",
        )
    return run


async def _get_every_staged_row(db: AsyncSession, run: ImportRun) -> list[ImportStagedRow]:
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


async def _finish_run_commit(db: AsyncSession, run: ImportRun, summary: BaseModel) -> None:
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
