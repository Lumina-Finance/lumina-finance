"""Committing a staged transaction import run into the ledger"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun, ImportRunSource, ImportStagedRow
from app.models.user import User
from app.schemas.transaction import (
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
    TransactionImportMerchantMapping,
    TransactionImportRequest,
    TransactionImportResponse,
    TransactionImportRow,
)
from app.services.importers.generic.service import import_transactions
from app.services.importers.shared.run_commit import finish_run_commit, get_every_staged_row, lock_run_for_commit


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
        HTTPException: Raised with 404 for a run that is absent or not the caller's, or a mapped
            account they cannot reach, 409 when another request holds the run, and 422 when another
            importer opened the run, when the staged rows do not add up to the file the run
            declared, when a staged row cannot be written as it stands, or when a mapping the run
            recorded no longer resolves
    """
    run = await lock_run_for_commit(db, run_id, ImportRunSource.GENERIC)
    if run.committed_at is not None:
        return TransactionImportResponse.model_validate(run.summary)

    rows = await get_every_staged_row(db, run)
    response = await import_transactions(db, user, _build_import_request(run, rows))
    await finish_run_commit(db, run, response)
    return response


def _build_import_request(run: ImportRun, rows: list[ImportStagedRow]) -> TransactionImportRequest:
    """Rebuild the whole file from its run and staged rows

    Args:
        run: Run holding the merged account, category and merchant mappings
        rows: Staged rows in file order

    Returns:
        The import payload the service takes
    """
    return TransactionImportRequest(
        accounts=[TransactionImportAccountMapping.model_validate(mapping) for mapping in run.account_mappings.values()],
        categories=[
            TransactionImportCategoryMapping.model_validate(mapping) for mapping in run.category_mappings.values()
        ],
        merchants=[
            TransactionImportMerchantMapping.model_validate(mapping) for mapping in run.merchant_mappings.values()
        ],
        rows=[TransactionImportRow.model_validate(row.payload) for row in rows],
    )
