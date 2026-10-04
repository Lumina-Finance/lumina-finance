"""Staging a generic CSV import as a run, and committing it into the ledger in one transaction"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun, ImportRunSource, ImportStagedRow
from app.models.user import User
from app.schemas.import_run import (
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
    TransactionImportMerchantMapping,
    TransactionImportRequest,
    TransactionImportResponse,
    TransactionImportRow,
    TransactionImportStageRequest,
)
from app.services.importers.generic.service import import_transactions
from app.services.importers.shared.run_commit import commit_run
from app.services.importers.shared.run_staging import stage_run_batch

# The runs the CSV endpoints take
_GENERIC_RUN_SOURCES = frozenset({ImportRunSource.GENERIC})


async def stage_import_batch(
    db: AsyncSession,
    user: User,
    run_id: uuid.UUID,
    data: TransactionImportStageRequest,
) -> None:
    """Park one batch of a file against its run, after checking the mappings it declares

    A CSV row names the account at its other end, which can be answered as money that left the
    tracked accounts, and the batch carries the payee values the user answered by hand

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run the batch belongs to
        data: Mappings this batch's rows reference, and the rows themselves

    Returns:
        None

    Raises:
        HTTPException: Raised with 404 for a run that is not the caller's or a mapped account they
            cannot reach, 409 for a run already committed or one another request is working on, and
            422 for a run another importer opened, a batch reaching past the file's row count,
            re-declaring a source differently, or declaring a mapping staging can already tell is
            unusable
    """
    await stage_run_batch(
        db,
        user,
        run_id,
        _GENERIC_RUN_SOURCES,
        accounts=data.accounts,
        categories=data.categories,
        rows=data.rows,
        start_row_index=data.start_row_index,
        allows_outside_accounts=True,
        merchants=data.merchants,
    )


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
    return await commit_run(
        db,
        run_id,
        _GENERIC_RUN_SOURCES,
        TransactionImportResponse,
        lambda run, rows: import_transactions(db, user, _build_import_request(run, rows)),
    )


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
