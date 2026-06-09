"""Transaction import orchestration service"""
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import TransactionImportRequest, TransactionImportResponse, TransactionImportRow
from app.services.cache_state import mark_cache_changed_for_scope, mark_user_cache_changed
from app.services.snapshots import recompute_snapshots_from
from app.services.transactions.imports.accounts import get_or_create_import_accounts_by_source
from app.services.transactions.imports.amounts import parse_import_amount_to_minor_units
from app.services.transactions.imports.categories import get_or_create_import_categories_by_source
from app.services.transactions.imports.currencies import get_import_currencies_by_code
from app.services.transactions.imports.merchants import (
    get_or_create_import_merchant,
    get_personal_import_merchants_by_name,
)
from app.services.transactions.imports.row_mappings import (
    get_import_row_account,
    get_import_row_category,
    validate_import_category_can_be_used_for_account,
)
from app.services.transactions.imports.stats import ImportStats
from app.services.transactions.imports.tags import get_or_create_import_tags, get_personal_import_tags_by_name


async def import_transactions(
    db: AsyncSession,
    user: User,
    data: TransactionImportRequest,
) -> TransactionImportResponse:
    """Create transactions from a frontend-compiled import payload

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: Prepared import payload from the frontend compiler

    Returns:
        Import summary containing transaction, account, category, merchant, tag, and affected account counts
    """
    stats = ImportStats()
    accounts_by_source = await get_or_create_import_accounts_by_source(db, user, data.accounts, stats)
    categories_by_source = await get_or_create_import_categories_by_source(db, user, data.categories, stats)
    currencies_by_code = await get_import_currencies_by_code(db, {account.currency for account in accounts_by_source.values()})
    merchants_by_name = await get_personal_import_merchants_by_name(db, user.id)
    tags_by_name = await get_personal_import_tags_by_name(db, user.id)
    first_import_date_by_account_id: dict[uuid.UUID, date] = {}

    for row in data.rows:
        account = get_import_row_account(accounts_by_source, row.account_source)
        category = get_import_row_category(categories_by_source, row.category_source)
        validate_import_category_can_be_used_for_account(category, account, user.id)

        currency = currencies_by_code[account.currency]
        amount = parse_import_amount_to_minor_units(row.amount, currency)
        merchant = await get_or_create_import_merchant(db, user.id, row.merchant_name, merchants_by_name, stats)
        tags = await get_or_create_import_tags(db, user.id, row.tag_names, tags_by_name, stats)

        await _insert_imported_transaction_with_tag_links(
            db,
            user_id=user.id,
            account=account,
            category=category,
            row=row,
            amount=amount,
            merchant=merchant,
            tags=tags,
        )

        current_first_import_date = first_import_date_by_account_id.get(account.id)
        first_import_date_by_account_id[account.id] = (
            row.dt if current_first_import_date is None else min(current_first_import_date, row.dt)
        )

    await db.flush()
    await _recompute_snapshots_for_imported_accounts(db, first_import_date_by_account_id)
    await _mark_caches_changed_for_imported_accounts(db, user.id, accounts_by_source, first_import_date_by_account_id)
    await db.commit()

    return _build_transaction_import_response(data, stats, accounts_by_source, categories_by_source, first_import_date_by_account_id)


async def _recompute_snapshots_for_imported_accounts(
    db: AsyncSession,
    first_import_date_by_account_id: dict[uuid.UUID, date],
) -> None:
    """Recompute balance snapshots for accounts touched by imported transactions

    Args:
        db: Active database session
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID

    Returns:
        None
    """
    # Recompute each account from its earliest imported date to keep later balances aligned
    for account_id, first_import_date in first_import_date_by_account_id.items():
        await recompute_snapshots_from(db, account_id, first_import_date)


async def _mark_caches_changed_for_imported_accounts(
    db: AsyncSession,
    user_id: uuid.UUID,
    accounts_by_source: dict[str, Account],
    first_import_date_by_account_id: dict[uuid.UUID, date],
) -> None:
    """Mark user and account-scope caches changed after importing transactions

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        accounts_by_source: Account rows keyed by import source
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID

    Returns:
        None
    """
    await mark_user_cache_changed(db, user_id)
    affected_accounts = {account.id: account for account in accounts_by_source.values()}

    # Mark each affected account scope so personal and group cache entries refresh
    for account_id in first_import_date_by_account_id:
        account = affected_accounts[account_id]
        await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)


def _build_transaction_import_response(
    data: TransactionImportRequest,
    stats: ImportStats,
    accounts_by_source: dict[str, Account],
    categories_by_source: dict[str, Category],
    first_import_date_by_account_id: dict[uuid.UUID, date],
) -> TransactionImportResponse:
    """Build the API summary returned after importing transactions

    Args:
        data: Prepared import payload from the frontend compiler
        stats: Import summary counters updated during the import
        accounts_by_source: Account rows keyed by import source
        categories_by_source: Category rows keyed by import source
        first_import_date_by_account_id: Earliest imported transaction date by affected account ID

    Returns:
        Import response with created, reused, and affected account details
    """
    # Sort affected account IDs for deterministic API responses
    affected_account_ids = sorted(first_import_date_by_account_id, key=str)

    return TransactionImportResponse(
        transactions_created=len(data.rows),
        accounts_created=stats.accounts_created,
        accounts_reused=stats.accounts_reused,
        categories_created=stats.categories_created,
        categories_reused=stats.categories_reused,
        merchants_created=stats.merchants_created,
        merchants_reused=stats.merchants_reused,
        tags_created=stats.tags_created,
        tags_reused=stats.tags_reused,
        affected_account_ids=affected_account_ids,
        account_source_ids={source: account.id for source, account in accounts_by_source.items()},
        category_source_ids={source: category.id for source, category in categories_by_source.items()},
        created_account_ids=stats.created_account_ids,
        created_category_ids=stats.created_category_ids,
        created_merchant_ids=stats.created_merchant_ids,
        created_tag_ids=stats.created_tag_ids,
    )


async def _insert_imported_transaction_with_tag_links(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    account: Account,
    category: Category,
    row: TransactionImportRow,
    amount: int,
    merchant: Merchant | None,
    tags: list[Tag],
) -> None:
    """Insert an imported transaction and its tag links into the database session

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        account: Account selected for the import row
        category: Category selected for the import row
        row: Import row being written
        amount: Parsed transaction amount in account-currency minor units
        merchant: Optional merchant selected for the import row
        tags: Tag rows selected for the import row

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
    )
    db.add(transaction)
    await db.flush()

    # Add tag links after the transaction id is available from the flush
    for tag in tags:
        db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag.id))
