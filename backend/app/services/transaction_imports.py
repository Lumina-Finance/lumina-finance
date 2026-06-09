"""Transaction import orchestration service"""
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import TransactionImportRequest, TransactionImportResponse
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
from app.services.transactions.imports.stats import ImportStats
from app.services.transactions.imports.tags import get_or_create_import_tags, get_personal_import_tags_by_name
from app.services.transactions.imports.validation import strip_import_text_or_raise


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
        Import summary containing created rows, reused records, and affected account IDs
    """
    stats = ImportStats()
    accounts_by_source = await get_or_create_import_accounts_by_source(db, user, data.accounts, stats)
    categories_by_source = await get_or_create_import_categories_by_source(db, user, data.categories, stats)
    currencies_by_code = await get_import_currencies_by_code(db, {account.currency for account in accounts_by_source.values()})
    merchants_by_name = await get_personal_import_merchants_by_name(db, user.id)
    tags_by_name = await get_personal_import_tags_by_name(db, user.id)
    affected_from: dict[uuid.UUID, date] = {}

    for row in data.rows:
        account = _get_required(accounts_by_source, strip_import_text_or_raise(row.account_source, "Account source"), "Account source")
        category = _get_required(categories_by_source, strip_import_text_or_raise(row.category_source, "Category source"), "Category source")
        _ensure_category_valid_for_account(category, account, user.id)

        currency = currencies_by_code[account.currency]
        amount = parse_import_amount_to_minor_units(row.amount, currency)
        merchant = await get_or_create_import_merchant(db, user.id, row.merchant_name, merchants_by_name, stats)
        tags = await get_or_create_import_tags(db, user.id, row.tag_names, tags_by_name, stats)

        txn = Transaction(
            created_by_user_id=user.id,
            account_id=account.id,
            dt=row.dt,
            merchant_id=merchant.id if merchant else None,
            category_id=category.id,
            amount=amount,
            currency=account.currency,
            fx_rate=None,
            notes=row.notes,
        )
        db.add(txn)
        await db.flush()

        for tag in tags:
            db.add(TransactionTag(transaction_id=txn.id, tag_id=tag.id))

        current_from = affected_from.get(account.id)
        affected_from[account.id] = row.dt if current_from is None else min(current_from, row.dt)

    await db.flush()
    for account_id, from_dt in affected_from.items():
        await recompute_snapshots_from(db, account_id, from_dt)

    await mark_user_cache_changed(db, user.id)
    affected_accounts = {account.id: account for account in accounts_by_source.values()}
    for account_id in affected_from:
        account = affected_accounts[account_id]
        await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)

    await db.commit()

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
        affected_account_ids=sorted(affected_from, key=str),
        account_source_ids={source: account.id for source, account in accounts_by_source.items()},
        category_source_ids={source: category.id for source, category in categories_by_source.items()},
        created_account_ids=stats.created_account_ids,
        created_category_ids=stats.created_category_ids,
        created_merchant_ids=stats.created_merchant_ids,
        created_tag_ids=stats.created_tag_ids,
    )


def _ensure_category_valid_for_account(category: Category, account: Account, user_id: uuid.UUID) -> None:
    """Validate that a mapped category can be used for an account

    Args:
        category: Category selected for the import row
        account: Account selected for the import row
        user_id: Identifier for the user running the import

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when the category cannot be used by the account
    """
    if category.is_system or (category.owner_id == user_id and category.group_id is None) or category.group_id == account.group_id:
        return
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")


def _get_required(mapping: dict[str, Account] | dict[str, Category], source: str, label: str):
    """Return an import source mapping value or raise when it is missing

    Args:
        mapping: Lookup keyed by import source
        source: Import source requested by a row
        label: Human-readable field label used in validation errors

    Returns:
        Account or category mapped to the requested source

    Raises:
        HTTPException: Raised with 422 when the source is not declared
    """
    value = mapping.get(source)
    if value is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} is not mapped: {source}")
    return value
