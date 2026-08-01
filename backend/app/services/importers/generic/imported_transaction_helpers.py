"""Imported transaction helpers"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import TransferOtherAccountScope
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionImportRow
from app.services.importers.generic.amounts import parse_import_amount_to_minor_units
from app.services.importers.generic.lookup_helpers import TransactionImportLookups
from app.services.importers.shared.merchants import get_or_create_import_merchant
from app.services.importers.shared.row_mappings import (
    get_import_row_account,
    get_import_row_category,
    get_import_row_other_account,
    validate_import_category_can_be_used_for_account,
)
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import get_or_create_import_tags
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


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
    """
    first_import_date_by_account_id: dict[uuid.UUID, date] = {}

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
        other_account_id, other_account_scope = get_import_row_other_account(
            import_lookups.accounts_by_source,
            import_lookups.outside_account_sources,
            row.other_account_source,
            category,
            account,
        )

        currency = import_lookups.currencies_by_code[account.currency]
        amount = parse_import_amount_to_minor_units(row.amount, currency)
        merchant = await get_or_create_import_merchant(
            db,
            user_id,
            row.merchant_name,
            import_lookups.merchants_by_name,
            stats,
        )
        tags = await get_or_create_import_tags(db, user_id, row.tag_names, import_lookups.tags_by_name, stats)

        await _insert_imported_transaction_and_tags(
            db,
            user_id=user_id,
            account=account,
            category=category,
            row=row,
            amount=amount,
            merchant=merchant,
            tags=tags,
            other_account_id=other_account_id,
            other_account_scope=other_account_scope,
        )

        current_first_import_date = first_import_date_by_account_id.get(account.id)
        first_import_date_by_account_id[account.id] = (
            row.dt if current_first_import_date is None else min(current_first_import_date, row.dt)
        )

    return first_import_date_by_account_id


async def _insert_imported_transaction_and_tags(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    account: Account,
    category: Category,
    row: TransactionImportRow,
    amount: int,
    merchant: Merchant | None,
    tags: list[Tag],
    other_account_id: uuid.UUID | None,
    other_account_scope: TransferOtherAccountScope | None,
) -> None:
    """Insert an imported transaction and its transaction-tag rows into the session

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        account: Account selected for the import row
        category: Category selected for the import row
        row: Import row being written
        amount: Parsed transaction amount in account-currency minor units
        merchant: Optional merchant selected for the import row
        tags: Tag rows selected for the import row
        other_account_id: Account recorded as the other side of a transfer, if any
        other_account_scope: Where the other side sits, or None when the file left it unanswered

    Returns:
        None
    """
    transaction = Transaction(
        created_by_user_id=user_id,
        account_id=account.id,
        dt=row.dt,
        merchant_id=merchant.id if merchant else None,
        category_id=category.id,
        amount=amount,
        currency=account.currency,
        fx_rate=None,
        notes=row.notes,
        other_account_id=other_account_id,
        other_account_scope=other_account_scope,
    )
    db.add(transaction)
    await db.flush()

    # Add transaction-tag rows after the transaction id is available from the flush
    for tag in tags:
        transaction_tag = TransactionTag(transaction_id=transaction.id, tag_id=tag.id)
        db.add(transaction_tag)
