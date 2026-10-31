"""Transaction import orchestration service"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.import_run import TransactionImportRequest, TransactionImportResponse
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.importers.generic.row_resolution import resolve_import_rows
from app.services.importers.shared.lookups import load_import_lookups
from app.services.importers.shared.save_results import build_import_summary, mark_import_caches_changed
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.transaction_writer import ImportedTransaction, write_imported_transactions
from app.services.transactions.bank_transaction_ids import BankTransactionKey, find_held_bank_transactions

# Answered when another import saved some of the same bank transactions into the account first. The
# page reads it as an interrupted save and keeps the upload, and saving it again leaves those out
BANK_TRANSACTION_RACE_DETAIL = "Another import saved some of these transactions first, so save this one again"


async def import_transactions(
    db: AsyncSession,
    user: User,
    data: TransactionImportRequest,
    import_run_id: uuid.UUID,
) -> TransactionImportResponse:
    """Create transactions from a whole staged import file

    The caller owns the transaction, so nothing here is durable until it commits. That is what lets
    the rows, the clearing of what was staged and the run's own stamp land together or not at all

    A row carrying its bank's ID is left out when its account already holds that ID under the same
    bank account, so a statement overlapping an earlier one adds only what is new

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: The whole file, rebuilt from its run
        import_run_id: Run being committed, which every written transaction is stamped with

    Returns:
        Import summary containing transaction, account, category, merchant, tag, and affected account
        counts, with the rows left out as already in their account

    Raises:
        HTTPException: Raised with 409 when another import wrote one of the same bank transactions
            into the account while this one was saving, and 422 when the import repeats a bank ID in
            one account or every row is already in its account
    """
    stats = ImportStats()
    import_lookups = await load_import_lookups(
        db,
        user,
        data.accounts,
        data.categories,
        stats,
        _get_counterparty_only_sources(data),
    )
    resolved = resolve_import_rows(data.rows, import_lookups, user.id)
    transactions = await _leave_out_held_bank_transactions(db, resolved)

    # The index holding each bank transaction once per account refuses the second of two imports
    # racing to write the same one, and the whole commit goes with it
    try:
        first_import_date_by_account_id = await write_imported_transactions(
            db,
            user_id=user.id,
            import_run_id=import_run_id,
            transactions=transactions,
            merchant_mappings=data.merchants,
            tag_mappings=data.tags,
            import_lookups=import_lookups,
            stats=stats,
        )
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=BANK_TRANSACTION_RACE_DETAIL) from error

    await recompute_account_snapshots(db, first_import_date_by_account_id)
    await mark_import_caches_changed(
        db,
        user.id,
        import_lookups.accounts_by_source,
        first_import_date_by_account_id,
    )

    return build_import_summary(
        TransactionImportResponse,
        transactions_created=len(transactions),
        stats=stats,
        import_lookups=import_lookups,
        first_import_date_by_account_id=first_import_date_by_account_id,
        transactions_already_imported=len(resolved) - len(transactions),
    )


def _get_bank_transaction_key(transaction: ImportedTransaction) -> BankTransactionKey | None:
    """Return what names a row's bank transaction inside its account, or None for a row with no bank ID"""
    if transaction.bank_transaction_hash is None:
        return None
    return transaction.account.id, transaction.bank_transaction_hash


async def _leave_out_held_bank_transactions(
    db: AsyncSession,
    transactions: list[ImportedTransaction],
) -> list[ImportedTransaction]:
    """Return the rows to write, leaving out those whose account already holds their bank transaction

    Left out before anything is written, so no merchant or tag is created for a row that never is

    Args:
        db: Active database session
        transactions: Resolved rows in file order

    Returns:
        The rows to write, in file order

    Raises:
        HTTPException: Raised with 422 when two rows carry the same bank transaction into one
            account, which the page leaves out before sending, or when every row is already in its
            account, so the save would write nothing and take away the earlier import's undo
    """
    keys: set[BankTransactionKey] = set()
    for transaction in transactions:
        key = _get_bank_transaction_key(transaction)
        if key is None:
            continue
        if key in keys:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"This import repeats a bank ID in {transaction.account.name}",
            )
        keys.add(key)

    held = await find_held_bank_transactions(db, keys)
    remaining = [transaction for transaction in transactions if _get_bank_transaction_key(transaction) not in held]
    if not remaining:
        account_names = sorted({transaction.account.name for transaction in transactions})
        where = account_names[0] if len(account_names) == 1 else "the accounts it goes to"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Every transaction in this import is already in {where}",
        )
    return remaining


def _get_counterparty_only_sources(data: TransactionImportRequest) -> set[str]:
    """Return the declared account sources no row in the file is written to

    Worked out from the rows rather than read off the payload, because these resolve under a
    weaker rule than an account rows are written to, and a client that could declare one would be
    choosing its own permission check. A source used both ways keeps the strict rule, since the
    rows using it are still written, and the whole file is resolved at once, so that holds across
    every row rather than within a part of it

    Args:
        data: The whole file, rebuilt from its run

    Returns:
        Trimmed sources that appear as no row's account source
    """
    row_account_sources = {row.account_source.strip() for row in data.rows}
    return {mapping.source.strip() for mapping in data.accounts} - row_account_sources
