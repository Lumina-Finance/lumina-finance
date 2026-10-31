"""Staging a generic CSV import as a run, and committing it into the ledger in one transaction"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.bank_transaction_key import seal_bank_transaction_hash
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
    TransactionImportStageRow,
    TransactionImportTagMapping,
)
from app.services.importers.generic.service import import_transactions
from app.services.importers.shared.layouts import save_import_layout
from app.services.importers.shared.run_commit import commit_run
from app.services.importers.shared.run_staging import stage_run_batch
from app.services.importers.shared.sources import save_import_sources

# The runs the CSV endpoints take. An OFX or QIF file is read in the browser into the same rows
_GENERIC_RUN_SOURCES = frozenset({ImportRunSource.GENERIC, ImportRunSource.OFX, ImportRunSource.QIF})


async def stage_import_batch(
    db: AsyncSession,
    user: User,
    run_id: uuid.UUID,
    data: TransactionImportStageRequest,
) -> None:
    """Park one batch of a file against its run, after checking the mappings it declares

    A CSV row names the account at its other end, which can be answered as money that left the
    tracked accounts, and the batch carries the merchant names the user answered by hand

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
        rows=[_seal_row(row) for row in data.rows],
        start_row_index=data.start_row_index,
        allows_outside_accounts=True,
        merchants=data.merchants,
        tags=data.tags,
    )


def _seal_row(row: TransactionImportStageRow) -> TransactionImportRow:
    """Replace the page's bank account and bank ID with their keyed hash before the row is staged

    The account number and ID are never staged or stored, only the keyed hash, and the commit reads
    it back from the staged row as it is

    Args:
        row: One row as the page sent it

    Returns:
        The row with the keyed hash of its bank account and bank ID, or none when it has no bank ID
    """
    fields = row.model_dump(exclude={"bank_account", "bank_transaction"})
    if row.bank_account is None or row.bank_transaction is None:
        return TransactionImportRow(**fields)
    return TransactionImportRow(**fields, bank_transaction_hash=seal_bank_transaction_hash(row.bank_account, row.bank_transaction))


async def commit_import_run(db: AsyncSession, user: User, run_id: uuid.UUID) -> TransactionImportResponse:
    """Write a staged run into the ledger, in one transaction with clearing what it staged

    A run already committed answers with the summary it returned the first time, so a commit whose
    response was lost can be repeated without importing the file twice. How the file was read is
    saved in the same transaction, for the one account its rows went to

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run to commit

    Returns:
        Import summary containing transaction, account, category, merchant, tag, and affected
        account counts

    Raises:
        HTTPException: Raised with 404 for a run that is absent or not the caller's, or a mapped
            account they cannot reach, 409 when another request holds the run or another import
            saved one of its bank transactions first, and 422 when another importer opened the run,
            when the staged rows do not add up to the file the run declared, when a staged row
            cannot be written as it stands, when a mapping the run recorded no longer resolves, or
            when every row is already in its account
    """

    async def write_run(run: ImportRun, rows: list[ImportStagedRow]) -> TransactionImportResponse:
        summary = await import_transactions(db, user, _build_import_request(run, rows), run.id)
        await save_import_layout(db, user, run, summary.affected_account_ids)
        await save_import_sources(db, user, run, summary.affected_account_ids)
        return summary

    return await commit_run(db, run_id, _GENERIC_RUN_SOURCES, TransactionImportResponse, write_run)


def _build_import_request(run: ImportRun, rows: list[ImportStagedRow]) -> TransactionImportRequest:
    """Rebuild the whole file from its run and staged rows

    Args:
        run: Run holding the merged account, category, merchant and tag mappings
        rows: Staged rows in file order

    Returns:
        The import payload the service takes
    """
    return TransactionImportRequest(
        accounts=[TransactionImportAccountMapping.model_validate(mapping) for mapping in run.account_mappings.values()],
        categories=[TransactionImportCategoryMapping.model_validate(mapping) for mapping in run.category_mappings.values()],
        merchants=[TransactionImportMerchantMapping.model_validate(mapping) for mapping in run.merchant_mappings.values()],
        tags=[TransactionImportTagMapping.model_validate(mapping) for mapping in run.tag_mappings.values()],
        rows=[TransactionImportRow.model_validate(row.payload) for row in rows],
    )
