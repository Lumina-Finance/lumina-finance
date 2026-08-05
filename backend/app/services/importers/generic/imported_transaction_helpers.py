"""Imported transaction helpers"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import TransferCounterpartyScope
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionImportRow
from app.services.importers.generic.amounts import parse_import_amount_to_minor_units
from app.services.importers.generic.lookup_helpers import TransactionImportLookups
from app.services.importers.shared.merchants import (
    create_missing_import_merchants,
    get_import_merchant,
)
from app.services.importers.shared.row_mappings import (
    get_import_row_account,
    get_import_row_category,
    get_import_row_counterparty_account,
    validate_import_category_can_be_used_for_account,
)
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import create_missing_import_tags, get_import_row_tags
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise

# Rows written before the session sends them and reads their ids back. A whole file is now one
# transaction, so flushing per row would be one round trip per row, and flushing once at the end
# would hold every row of a large file in the session before any of it moves
_TRANSACTION_FLUSH_CHUNK = 500


async def create_imported_transactions(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    rows: list[TransactionImportRow],
    import_lookups: TransactionImportLookups,
    stats: ImportStats,
) -> dict[uuid.UUID, date]:
    """Create imported transaction rows and return first import dates by account

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        rows: Prepared transaction rows from the import payload
        import_lookups: Lookup maps needed to create imported transaction rows
        stats: Import summary counters updated during the import

    Returns:
        Earliest imported transaction date by affected account ID

    Raises:
        HTTPException: Raised with 422 when a row cannot be written as the payload states it
    """
    first_import_date_by_account_id: dict[uuid.UUID, date] = {}
    pending_transaction_tags: list[tuple[Transaction, list[Tag]]] = []

    # Everything the file introduces is created before the rows are walked, so each of them costs
    # one insert for the whole file rather than one per row that first mentions it. A row refused
    # further down takes the whole commit with it, so nothing survives having been created here
    await create_missing_import_merchants(
        db,
        user_id,
        (row.merchant_name for row in rows),
        import_lookups.merchants_by_key,
        stats,
    )
    await create_missing_import_tags(
        db,
        user_id,
        (tag_name for row in rows for tag_name in row.tag_names),
        import_lookups.tags_by_name,
        stats,
    )

    # Convert each frontend-compiled row into a transaction and track affected account dates
    for row in rows:
        account_source = strip_import_text_or_raise(row.account_source, "Account source")
        if account_source in import_lookups.outside_account_sources:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Rows cannot be written to an account source that is outside the tracked accounts: {account_source}",
            )

        account = get_import_row_account(import_lookups.accounts_by_source, row.account_source)
        category = get_import_row_category(import_lookups.categories_by_source, row.category_source)
        validate_import_category_can_be_used_for_account(category, account, user_id)
        counterparty_account_id, counterparty_account_scope = get_import_row_counterparty_account(
            import_lookups.accounts_by_source,
            import_lookups.outside_account_sources,
            row.counterparty_account_source,
            category,
            account,
        )

        currency = import_lookups.currencies_by_code[account.currency]
        amount = parse_import_amount_to_minor_units(row.amount, currency)
        merchant = get_import_merchant(row.merchant_name, import_lookups.merchants_by_key, stats)
        tags = get_import_row_tags(row.tag_names, import_lookups.tags_by_name, stats)

        transaction = _build_imported_transaction(
            user_id=user_id,
            account=account,
            category=category,
            row=row,
            amount=amount,
            merchant=merchant,
            counterparty_account_id=counterparty_account_id,
            counterparty_account_scope=counterparty_account_scope,
        )
        db.add(transaction)
        pending_transaction_tags.append((transaction, tags))

        if len(pending_transaction_tags) >= _TRANSACTION_FLUSH_CHUNK:
            await _add_imported_transaction_tags(db, pending_transaction_tags)
            pending_transaction_tags.clear()

        current_first_import_date = first_import_date_by_account_id.get(account.id)
        first_import_date_by_account_id[account.id] = (
            row.dt if current_first_import_date is None else min(current_first_import_date, row.dt)
        )

    await _add_imported_transaction_tags(db, pending_transaction_tags)
    return first_import_date_by_account_id


def _build_imported_transaction(
    *,
    user_id: uuid.UUID,
    account: Account,
    category: Category,
    row: TransactionImportRow,
    amount: int,
    merchant: Merchant | None,
    counterparty_account_id: uuid.UUID | None,
    counterparty_account_scope: TransferCounterpartyScope | None,
) -> Transaction:
    """Build the transaction one import row writes

    Args:
        user_id: Identifier for the user running the import
        account: Account selected for the import row
        category: Category selected for the import row
        row: Import row being written
        amount: Parsed transaction amount in account-currency minor units
        merchant: Optional merchant selected for the import row
        counterparty_account_id: Counterparty account recorded on a transfer, if any
        counterparty_account_scope: Where the counterparty sits, or None for a category that records neither

    Returns:
        The transaction row, not yet added to the session
    """
    return Transaction(
        created_by_user_id=user_id,
        account_id=account.id,
        dt=row.dt,
        merchant_id=merchant.id if merchant else None,
        category_id=category.id,
        amount=amount,
        currency=account.currency,
        fx_rate=None,
        notes=row.notes,
        counterparty_account_id=counterparty_account_id,
        counterparty_account_scope=counterparty_account_scope,
    )


async def _add_imported_transaction_tags(
    db: AsyncSession,
    pending_transaction_tags: list[tuple[Transaction, list[Tag]]],
) -> None:
    """Write the transactions waiting in the session, then attach their tags

    Args:
        db: Active database session
        pending_transaction_tags: Transactions added since the last flush, each with its tags

    Returns:
        None
    """
    if not pending_transaction_tags:
        return

    await db.flush()

    # Add transaction-tag rows after the transaction ids are available from the flush
    for transaction, tags in pending_transaction_tags:
        for tag in tags:
            db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag.id))
