"""Writing every import's resolved rows as transactions, with the merchants and tags they need"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import TransferCounterpartyScope
from app.models.category import Category
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.schemas.import_run import TransactionImportMerchantMapping
from app.services.importers.shared.lookups import ImportLookups
from app.services.importers.shared.merchants import (
    create_missing_import_merchants,
    get_import_merchant,
    get_no_payee_merchants,
)
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import create_missing_import_tags, get_import_row_tags

# Transactions sent per flush. A whole import is one transaction, so flushing per row would be one
# round trip per row, and flushing once at the end would hold every row of a large file in the
# session before any of it moves. A chunk this size goes out as one insert, since SQLAlchemy pages
# a multi-row insert at 1000 rows by default
IMPORT_WRITE_CHUNK = 1000


@dataclass(frozen=True)
class ImportedTransaction:
    """One import row already resolved to the transaction it writes

    Attributes:
        account: Account the transaction is written to
        dt: Transaction date
        amount: Signed amount in account-currency minor units
        category: Category applied to the transaction
        merchant_name: Payee text as the file states it, or None where it states none
        notes: Notes written on the transaction
        tag_names: Tag names as the file states them, blanks and repeats included
        counterparty_account_id: Account at the other end of a transfer, if the row names one
        counterparty_account_scope: Where the other end sits, or None for a category that records neither
    """

    account: Account
    dt: date
    amount: int
    category: Category
    merchant_name: str | None
    notes: str | None
    tag_names: list[str]
    counterparty_account_id: uuid.UUID | None
    counterparty_account_scope: TransferCounterpartyScope | None


async def write_imported_transactions(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    transactions: list[ImportedTransaction],
    merchant_mappings: list[TransactionImportMerchantMapping],
    import_lookups: ImportLookups,
    stats: ImportStats,
) -> dict[uuid.UUID, date]:
    """Write resolved rows as transactions with their tags, leaving nothing unflushed

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        transactions: Resolved rows in file order
        merchant_mappings: The payee values the user answered by hand, which may be none of them
        import_lookups: Lookup maps the rows were resolved from, extended with created merchants and tags
        stats: Import summary counters updated during the import

    Returns:
        Earliest imported transaction date by affected account ID, in the order the rows first
        reach each account

    Raises:
        HTTPException: Raised with 422 when a merchant answer or name cannot be used or a tag name is
            too long, and 500 when the shared merchants are not seeded
    """
    first_import_date_by_account_id: dict[uuid.UUID, date] = {}
    no_payee_merchants = get_no_payee_merchants(import_lookups.merchants)

    # Everything the import introduces is created before the rows are walked, so each of them costs
    # one insert for the whole import rather than one per row that first mentions it. A failure
    # further down takes the whole commit with it, so nothing survives having been created here
    await create_missing_import_merchants(
        db,
        user_id,
        (transaction.merchant_name for transaction in transactions),
        merchant_mappings,
        import_lookups.merchants,
        stats,
    )
    await create_missing_import_tags(
        db,
        user_id,
        (tag_name for transaction in transactions for tag_name in transaction.tag_names),
        import_lookups.tags_by_name,
        stats,
    )

    for chunk_start in range(0, len(transactions), IMPORT_WRITE_CHUNK):
        pending: list[tuple[Transaction, list[Tag]]] = []

        for imported in transactions[chunk_start:chunk_start + IMPORT_WRITE_CHUNK]:
            # Every transaction carries a merchant, so a row stating no payee, such as a transfer leg
            # or a balance adjustment, is stamped with the shared one for its kind
            merchant = (
                get_import_merchant(imported.merchant_name, import_lookups.merchants, stats)
                or no_payee_merchants.get_for_category(imported.category)
            )
            tags = get_import_row_tags(imported.tag_names, import_lookups.tags_by_name, stats)
            pending.append((
                Transaction(
                    created_by_user_id=user_id,
                    account_id=imported.account.id,
                    dt=imported.dt,
                    merchant_id=merchant.id,
                    category_id=imported.category.id,
                    amount=imported.amount,
                    currency=imported.account.currency,
                    fx_rate=None,
                    notes=imported.notes,
                    counterparty_account_id=imported.counterparty_account_id,
                    counterparty_account_scope=imported.counterparty_account_scope,
                ),
                tags,
            ))

            current_first = first_import_date_by_account_id.get(imported.account.id)
            first_import_date_by_account_id[imported.account.id] = (
                imported.dt if current_first is None else min(current_first, imported.dt)
            )

        # One flush per chunk assigns ids to the whole chunk, so its tag links are added without a
        # round trip per transaction and go out with the next flush
        db.add_all([transaction for transaction, _ in pending])
        await db.flush()
        for transaction, tags in pending:
            for tag in tags:
                db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag.id))

    await db.flush()
    return first_import_date_by_account_id
