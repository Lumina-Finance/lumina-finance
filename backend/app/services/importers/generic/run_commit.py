"""Committing a staged transaction import run into the ledger"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun, ImportStagedRow
from app.models.user import User
from app.schemas.transaction import (
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
    TransactionImportRequest,
    TransactionImportResponse,
    TransactionImportRow,
)
from app.services.importers.generic.service import import_transactions

# Postgres raises this when a row wanted for update is held by another transaction. A second commit
# is refused on it rather than queueing, since waiting would hold a pooled connection for as long
# as the import in front of it takes
_LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"


async def commit_import_run(db: AsyncSession, user: User, run_id: uuid.UUID) -> TransactionImportResponse:
    """Write a staged run into the ledger, in one transaction with clearing what it staged

    A run already committed answers with the summary it returned the first time, so a commit whose
    response was lost can be repeated without importing the file twice

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run to commit

    Returns:
        Import summary containing transaction, account, category, merchant, tag, and affected
        account counts

    Raises:
        HTTPException: Raised with 404 for a run that is not the caller's, and 409 when another
            commit holds it or when the staged rows do not add up to the file the run declared
    """
    run = await _lock_run_for_commit(db, run_id)
    if run.committed_at is not None:
        return TransactionImportResponse.model_validate(run.summary)

    rows = await _get_staged_rows(db, run_id)
    if len(rows) != run.expected_transaction_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This import has {len(rows)} of its {run.expected_transaction_count} rows staged",
        )

    response = await import_transactions(db, user, _build_import_request(run, rows))

    # The staged copy has served its purpose once the rows are in the ledger, and it goes in the
    # same transaction as the rows so neither can outlive the other
    await db.execute(delete(ImportStagedRow).where(ImportStagedRow.import_run_id == run_id))
    run.committed_at = datetime.now(UTC)
    run.summary = response.model_dump(mode="json")
    await db.commit()
    return response


async def _lock_run_for_commit(db: AsyncSession, run_id: uuid.UUID) -> ImportRun:
    """Return the caller's run, held until this transaction ends

    The row-level security policy is what scopes this to the caller, so another user's run is
    absent rather than refused

    Args:
        db: Active database session
        run_id: Run to load

    Returns:
        The run, locked for the rest of the transaction

    Raises:
        HTTPException: Raised with 404 when the run is not the caller's, and 409 when another
            commit already holds it
    """
    query = select(ImportRun).where(ImportRun.id == run_id).with_for_update(nowait=True)

    try:
        run = (await db.execute(query)).scalar_one_or_none()
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) != _LOCK_NOT_AVAILABLE_SQLSTATE:
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This import is already being committed",
        ) from exc

    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found")
    return run


async def _get_staged_rows(db: AsyncSession, run_id: uuid.UUID) -> list[ImportStagedRow]:
    """Return a run's staged rows in the order they appeared in the file

    Args:
        db: Active database session
        run_id: Run whose rows are wanted

    Returns:
        Staged rows ordered by their position in the file
    """
    # Ordered by position so the import reads the file as the user sees it, which is what makes a
    # refusal quoting a row match what they are looking at
    query = select(ImportStagedRow).where(ImportStagedRow.import_run_id == run_id).order_by(ImportStagedRow.row_index)
    return list((await db.execute(query)).scalars().all())


def _build_import_request(run: ImportRun, rows: list[ImportStagedRow]) -> TransactionImportRequest:
    """Rebuild the whole file from its run and staged rows

    Args:
        run: Run holding the merged account and category mappings
        rows: Staged rows in file order

    Returns:
        The import payload the service takes
    """
    return TransactionImportRequest(
        accounts=[TransactionImportAccountMapping.model_validate(mapping) for mapping in run.account_mappings.values()],
        categories=[
            TransactionImportCategoryMapping.model_validate(mapping) for mapping in run.category_mappings.values()
        ],
        rows=[TransactionImportRow.model_validate(row.payload) for row in rows],
    )
