"""Transaction API routes"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.import_run import ImportRunSource
from app.models.user import User
from app.schemas.import_run import (
    AccountImportSourceResponse,
    CheckHeldBankTransactionsRequest,
    CsvImportLayoutResponse,
    HeldBankTransactionsResponse,
    ImportRunArchiveRequest,
    ImportRunBudgetsRequest,
    ImportUndoResponse,
    JournalImportRunResponse,
    JournalImportStageRequest,
    LastImportResponse,
    SavedImportRunResponse,
    TransactionImportResponse,
    TransactionImportRunRequest,
    TransactionImportRunResponse,
    TransactionImportStageRequest,
)
from app.schemas.transaction import (
    BulkDeleteTransactionsRequest,
    BulkDeleteTransactionsResponse,
    BulkUpdateTransactionsRequest,
    BulkUpdateTransactionsResponse,
    CreateTransactionRequest,
    LinkRefundRequest,
    TransactionResponse,
    TransactionsOverview,
    UpdateTransactionRequest,
)
from app.services.importers import (
    commit_import_run,
    commit_journal_run,
    delete_import_run,
    find_held_import_rows,
    get_last_import,
    is_import_run_saved,
    list_import_layouts,
    list_import_sources,
    open_import_run,
    stage_import_archive,
    stage_import_batch,
    stage_import_budgets,
    stage_journal_batch,
    undo_import_run,
)
from app.services.transactions.bulk_update import bulk_update_transactions
from app.services.transactions.creation import create_transaction_and_get_response
from app.services.transactions.deletion import bulk_delete_transactions, delete_transaction_for_user
from app.services.transactions.detail import get_transaction_response_for_user
from app.services.transactions.export import export_transactions_csv
from app.services.transactions.link_candidates import CandidateFilters, list_refund_link_candidates
from app.services.transactions.links import link_existing_refund, unlink_refund
from app.services.transactions.listing import list_transaction_responses
from app.services.transactions.overview import get_transactions_overview as get_transactions_overview_response
from app.services.transactions.update import update_transaction_and_get_response

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/overview", response_model=TransactionsOverview)
async def get_transactions_overview(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    account_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return aggregated transaction metrics for a date range

    Args:
        user: Authenticated user requesting the overview
        db: Active database session
        from_date: Optional inclusive start date for the transaction window
        to_date: Optional inclusive end date for the transaction window
        account_id: Optional account filter applied within the user's accessible accounts

    Returns:
        Aggregated transaction overview metrics for the selected filters

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    return await get_transactions_overview_response(
        db,
        user,
        from_date=from_date,
        to_date=to_date,
        account_id=account_id,
    )


@router.get("", response_model=list[TransactionResponse])
async def list_transactions(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    category_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    merchant_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    currency: Annotated[list[str] | None, Query()] = None,
    tag_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    tag_match: Annotated[str, Query()] = "all",
    min_amount: Annotated[int | None, Query(ge=0)] = None,
    max_amount: Annotated[int | None, Query(ge=0)] = None,
    amount_currency: Annotated[str | None, Query(min_length=3, max_length=3)] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    search_text: Annotated[str | None, Query(alias="q", max_length=200)] = None,
    sort_by: Annotated[str, Query()] = "dt",
    sort_order: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=50)] = 15,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return paginated transactions with sorting and filtering

    Args:
        user: Authenticated user requesting transactions
        db: Active database session
        account_id: Optional accounts to keep within the user's accessible accounts
        category_id: Optional categories to keep
        merchant_id: Optional merchants to keep
        currency: Optional transaction currencies to keep
        tag_id: Optional tags to filter by, combined per ``tag_match``
        tag_match: ``all`` to require every selected tag, ``any`` to require at least one
        min_amount: Optional inclusive lower bound on the amount magnitude in ``amount_currency`` minor units
        max_amount: Optional inclusive upper bound on the amount magnitude in ``amount_currency`` minor units
        amount_currency: Currency the amount bounds are expressed in, required when a bound is set
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text search across merchant name and notes
        sort_by: Transaction field used for ordering
        sort_order: Sort direction, either ``asc`` or ``desc``
        limit: Maximum number of transactions to return
        offset: Number of transactions to skip before returning rows

    Returns:
        Matching transaction responses for the requested page

    Raises:
        HTTPException: Raised with 422 for invalid sort fields, sort order, date
            range, tag match mode, or an amount range missing its currency
    """
    return await list_transaction_responses(
        db,
        user,
        account_ids=account_id,
        category_ids=category_id,
        merchant_ids=merchant_id,
        currencies=currency,
        tag_ids=tag_id,
        tag_match=tag_match,
        min_amount=min_amount,
        max_amount=max_amount,
        amount_currency=amount_currency,
        from_date=from_date,
        to_date=to_date,
        search_text=search_text,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )


@router.get("/{transaction_id}/refund-link-candidates", response_model=list[TransactionResponse])
async def list_refund_link_candidates_route(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    category_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    merchant_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    currency: Annotated[list[str] | None, Query()] = None,
    tag_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    tag_match: Annotated[str, Query()] = "all",
    min_amount: Annotated[int | None, Query(ge=0)] = None,
    max_amount: Annotated[int | None, Query(ge=0)] = None,
    amount_currency: Annotated[str | None, Query(min_length=3, max_length=3)] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    search_text: Annotated[str | None, Query(alias="q", max_length=200)] = None,
    unlinked_id: Annotated[list[uuid.UUID] | None, Query()] = None,
):
    """Return the transactions this one can be linked to as a refund or as the expense it refunds

    Args:
        transaction_id: The transaction a link is wanted for, from the route path
        user: Authenticated user
        db: Active database session
        account_id: Optional accounts to keep
        category_id: Optional categories to keep
        merchant_id: Optional merchants to keep
        currency: Optional transaction currencies to keep
        tag_id: Optional tags to filter by, combined per ``tag_match``
        tag_match: ``all`` to require every selected tag, ``any`` to require at least one
        min_amount: Optional inclusive lower bound on the amount magnitude in ``amount_currency`` minor units
        max_amount: Optional inclusive upper bound on the amount magnitude in ``amount_currency`` minor units
        amount_currency: Currency the amount bounds are expressed in, required when a bound is set
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text to find in merchant names and notes
        unlinked_id: Optional refunds whose link the open edit window will remove on Save, offered as unlinked

    Returns:
        The candidates linking would accept, exact amount first and then the nearest, newest first among
        equals, empty when it can't be linked
    """
    filters = CandidateFilters(
        account_ids=account_id,
        category_ids=category_id,
        merchant_ids=merchant_id,
        currencies=currency,
        tag_ids=tag_id,
        tag_match=tag_match,
        min_amount=min_amount,
        max_amount=max_amount,
        amount_currency=amount_currency,
        from_date=from_date,
        to_date=to_date,
    )
    return await list_refund_link_candidates(db, user, transaction_id, search_text, filters, unlinked_id)


@router.get("/export", response_class=StreamingResponse)
async def export_transactions(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    category_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    merchant_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    currency: Annotated[list[str] | None, Query()] = None,
    tag_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    tag_match: Annotated[str, Query()] = "all",
    min_amount: Annotated[int | None, Query(ge=0)] = None,
    max_amount: Annotated[int | None, Query(ge=0)] = None,
    amount_currency: Annotated[str | None, Query(min_length=3, max_length=3)] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    search_text: Annotated[str | None, Query(alias="q", max_length=200)] = None,
):
    """Stream every transaction matching the list's filters as a CSV file, newest first

    Takes the list's filters and readable-account scope without its page limit

    Args:
        user: Authenticated user exporting transactions
        db: Active database session
        account_id: Optional accounts to keep within the user's accessible accounts
        category_id: Optional categories to keep
        merchant_id: Optional merchants to keep
        currency: Optional transaction currencies to keep
        tag_id: Optional tags to filter by, combined per ``tag_match``
        tag_match: ``all`` to require every selected tag, ``any`` to require at least one
        min_amount: Optional inclusive lower bound on the amount magnitude in ``amount_currency`` minor units
        max_amount: Optional inclusive upper bound on the amount magnitude in ``amount_currency`` minor units
        amount_currency: Currency the amount bounds are expressed in, required when a bound is set
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text search across merchant name and notes

    Returns:
        A CSV download with a header row and one row per matching transaction

    Raises:
        HTTPException: Raised with 422 for an invalid date range, tag match mode, or an
            amount range missing its currency
    """
    export = await export_transactions_csv(
        db,
        user,
        account_ids=account_id,
        category_ids=category_id,
        merchant_ids=merchant_id,
        currencies=currency,
        tag_ids=tag_id,
        tag_match=tag_match,
        min_amount=min_amount,
        max_amount=max_amount,
        amount_currency=amount_currency,
        from_date=from_date,
        to_date=to_date,
        search_text=search_text,
    )
    return StreamingResponse(
        export.chunks,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{export.filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return one transaction after checking read access

    The route delegates read access checks and response assembly to the detail
    service

    Args:
        transaction_id: Transaction identifier from the route path
        user: Authenticated user requesting the transaction
        db: Active database session

    Returns:
        Transaction response enriched with tag and merchant display data
    """
    return await get_transaction_response_for_user(db, user, transaction_id)


@router.post("/import/held-bank-transactions", response_model=HeldBankTransactionsResponse)
async def check_held_bank_transactions(
    data: CheckHeldBankTransactionsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Say which OFX transactions their account already holds, so the preview can leave them out

    Stored bank IDs are keyed hashes only the server can make, so the page cannot compare them
    itself. Nothing is stored or logged, and the commit still skips whatever is held by then

    Args:
        data: Each transaction's bank account and bank ID with the account it would go into
        user: Authenticated user previewing the import
        db: Active database session

    Returns:
        The positions in the request that the account already holds
    """
    return HeldBankTransactionsResponse(held=await find_held_import_rows(db, user, data))


@router.post("/import/runs", response_model=TransactionImportRunResponse, status_code=status.HTTP_201_CREATED)
async def open_transaction_import_run(
    data: TransactionImportRunRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Open an import run for a file about to be staged

    A file too large for one request is staged over several, and none of it reaches
    the ledger until the run is committed

    Args:
        data: Rows the whole file will write, which importer's rows it stages, and how a CSV file was read
        user: Authenticated user running the import
        db: Active database session

    Returns:
        The opened run, which every later call for this file quotes
    """
    run = await open_import_run(
        db,
        user,
        data.expected_transaction_count,
        ImportRunSource(data.source),
        data.file_name,
        data.csv_layout,
    )
    return TransactionImportRunResponse(id=run.id)


@router.post("/import/runs/{run_id}/rows", status_code=status.HTTP_204_NO_CONTENT)
async def stage_transaction_import_rows(
    run_id: uuid.UUID,
    data: TransactionImportStageRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Park one batch of a file against its run

    Nothing is created here, so the route has no ids to return. The mappings the batch
    declares are checked as far as they can be without resolving a row

    Args:
        run_id: Run the batch belongs to
        data: Mappings this batch's rows reference, and the rows themselves
        user: Authenticated user running the import
        db: Active database session
    """
    await stage_import_batch(db, user, run_id, data)


@router.post("/import/runs/{run_id}/commit", response_model=TransactionImportResponse, status_code=status.HTTP_201_CREATED)
async def commit_transaction_import_run(
    run_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Write a staged run into the ledger

    The route delegates row resolution, creation, cache invalidation and affected
    snapshot recomputation to the import service, all inside one transaction

    Args:
        run_id: Run to commit
        user: Authenticated user running the import
        db: Active database session

    Returns:
        Import summary containing the transactions written and the accounts, categories, merchants
        and tags the import created or reused
    """
    return await commit_import_run(db, user, run_id)


@router.post("/import/runs/{run_id}/journal/rows", status_code=status.HTTP_204_NO_CONTENT)
async def stage_journal_import_rows(
    run_id: uuid.UUID,
    data: JournalImportStageRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Park one batch of a Firefly III or Actual Budget journal against its run

    Args:
        run_id: Run the batch belongs to
        data: Mappings this batch's rows reference, and the rows themselves
        user: Authenticated user running the import
        db: Active database session
    """
    await stage_journal_batch(db, user, run_id, data)


@router.put("/import/runs/{run_id}/budgets", status_code=status.HTTP_204_NO_CONTENT)
async def stage_import_run_budgets(
    run_id: uuid.UUID,
    data: ImportRunBudgetsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the budgets a provider run creates once its transactions are written

    Args:
        run_id: Run the budgets belong to
        data: Budget drafts and the category mappings they need
        user: Authenticated user running the import
        db: Active database session
    """
    await stage_import_budgets(db, user, run_id, data)


@router.put("/import/runs/{run_id}/archive", status_code=status.HTTP_204_NO_CONTENT)
async def stage_import_run_archive(
    run_id: uuid.UUID,
    data: ImportRunArchiveRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the accounts a provider run archives once everything else is written

    Args:
        run_id: Run the list belongs to
        data: Account mapping sources to archive
        user: Authenticated user running the import
        db: Active database session
    """
    await stage_import_archive(db, run_id, data)


@router.post(
    "/import/runs/{run_id}/journal/commit",
    response_model=JournalImportRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def commit_journal_import_run(
    run_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Write a staged Firefly III or Actual Budget journal, its budgets and its archiving in one transaction

    Args:
        run_id: Run to commit
        user: Authenticated user running the import
        db: Active database session

    Returns:
        Summary of everything the commit wrote
    """
    return await commit_journal_run(db, user, run_id)


@router.delete("/import/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction_import_run(
    run_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Drop a staged run and everything staged under it

    Args:
        run_id: Run to drop
        user: Authenticated user running the import
        db: Active database session
    """
    await delete_import_run(db, user, run_id)


@router.get("/import/last", response_model=LastImportResponse | None)
async def get_last_transaction_import(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the caller's last saved import while it can be undone, with what undoing it deletes and keeps

    Args:
        user: Authenticated user
        db: Active database session

    Returns:
        The last import saved within the undo window, or None
    """
    return await get_last_import(db, user)


@router.get("/import/runs/{run_id}", response_model=SavedImportRunResponse)
async def get_saved_transaction_import_run(
    run_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Answer whether one of the caller's saved imports is still there, which undoing it ends

    Args:
        run_id: Import to look for
        user: Authenticated user
        db: Active database session

    Returns:
        Whether the import is saved, which is false for one that is absent, not the caller's or not yet saved
    """
    return SavedImportRunResponse(is_saved=await is_import_run_saved(db, user, run_id))


@router.get("/import/layouts", response_model=list[CsvImportLayoutResponse])
async def list_transaction_import_layouts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return how CSV files were read for each of the caller's own accounts, keyed by their header rows

    Args:
        user: Authenticated user
        db: Active database session

    Returns:
        Every layout saved for an account the caller owns, the most recently saved first
    """
    return await list_import_layouts(db, user)


@router.get("/import/sources", response_model=list[AccountImportSourceResponse])
async def list_transaction_import_sources(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the importer last used for each of the caller's own accounts

    Args:
        user: Authenticated user
        db: Active database session

    Returns:
        One entry for every account the caller owns that an import has written to
    """
    return await list_import_sources(db, user)


@router.post("/import/runs/{run_id}/undo", response_model=ImportUndoResponse)
async def undo_transaction_import_run(
    run_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete every transaction a saved import wrote that is still there, all of them or none

    Args:
        run_id: Import to undo
        user: Authenticated user undoing the import
        db: Active database session

    Returns:
        How many transactions were deleted and the accounts they were in
    """
    return await undo_import_run(db, user, run_id)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: CreateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a transaction after validating target account write access

    The route delegates account access checks, related entity validation,
    transaction insertion, tag updates, snapshot recalculation, and response
    assembly to the creation service

    Args:
        data: Transaction creation payload
        user: Authenticated user creating the transaction
        db: Active database session

    Returns:
        Newly created transaction response
    """
    return await create_transaction_and_get_response(db, user, data)


@router.patch("/bulk", response_model=BulkUpdateTransactionsResponse)
async def bulk_update_transactions_route(
    data: BulkUpdateTransactionsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set shared details across several transactions

    Declared above the single-transaction route because a path parameter would otherwise read
    "bulk" as a transaction identifier

    Args:
        data: Transactions to change and the details to set
        user: Authenticated user applying the change
        db: Active database session

    Returns:
        The count of rows the request reached, whether or not a value on any of them changed, and
        the accounts affected, including a transfer's far side account before and after the edit
    """
    return await bulk_update_transactions(db, user, data)


@router.post("/bulk/delete", response_model=BulkDeleteTransactionsResponse)
async def bulk_delete_transactions_route(
    data: BulkDeleteTransactionsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete several transactions at once, all of them or none

    A POST rather than a DELETE, since a DELETE carrying a body is dropped by some clients and
    proxies

    Args:
        data: Transactions to delete
        user: Authenticated user deleting the transactions
        db: Active database session

    Returns:
        The count of rows deleted and the accounts they were in
    """
    return await bulk_delete_transactions(db, user, data)


@router.patch("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a transaction after checking write access

    The route delegates write access checks, related entity validation, field
    updates, tag updates, snapshot recalculation, and response assembly to the
    update service

    Args:
        transaction_id: Transaction identifier from the route path
        data: Partial transaction update payload
        user: Authenticated user updating the transaction
        db: Active database session

    Returns:
        Updated transaction response with current related display data
    """
    return await update_transaction_and_get_response(db, user, transaction_id, data)


@router.post("/{transaction_id}/refund-link", status_code=status.HTTP_204_NO_CONTENT)
async def link_refund_route(
    transaction_id: uuid.UUID,
    data: LinkRefundRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Link an existing transaction as the refund of an expense

    Both transactions stay as they are and no total changes. The refund is the transaction in the path

    Args:
        transaction_id: The refund, from the route path
        data: The expense it refunds
        user: Authenticated user linking them
        db: Active database session

    Returns:
        None
    """
    await link_existing_refund(db, user, transaction_id, data.original_transaction_id)


@router.delete("/{transaction_id}/refund-link", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_refund_route(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove the link between a refund and the expense it refunds

    Both transactions stay as they are. The refund is the transaction in the path

    Args:
        transaction_id: The refund, from the route path
        user: Authenticated user unlinking the refund
        db: Active database session

    Returns:
        None
    """
    await unlink_refund(db, user, transaction_id)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a transaction after checking write access

    The route delegates access checks, tag removal, transaction deletion,
    snapshot recalculation, and cache updates to the deletion service

    Args:
        transaction_id: Transaction identifier from the route path
        user: Authenticated user deleting the transaction
        db: Active database session

    Returns:
        None
    """
    await delete_transaction_for_user(db, user, transaction_id)
