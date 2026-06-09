"""Transaction import orchestration service"""
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import (
    TransactionImportCategoryMapping,
    TransactionImportRequest,
    TransactionImportResponse,
)
from app.services.cache_state import mark_cache_changed_for_scope, mark_user_cache_changed
from app.services.snapshots import recompute_snapshots_from
from app.services.transactions.imports.accounts import get_or_create_import_accounts_by_source
from app.services.transactions.imports.amounts import parse_import_amount_to_minor_units
from app.services.transactions.imports.stats import ImportStats
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
    categories_by_source = await _resolve_categories(db, user, data.categories, stats)
    currencies = await _load_currencies(db, {account.currency for account in accounts_by_source.values()})
    merchant_cache = await _load_personal_merchants(db, user.id)
    tag_cache = await _load_personal_tags(db, user.id)
    affected_from: dict[uuid.UUID, date] = {}

    for row in data.rows:
        account = _get_required(accounts_by_source, strip_import_text_or_raise(row.account_source, "Account source"), "Account source")
        category = _get_required(categories_by_source, strip_import_text_or_raise(row.category_source, "Category source"), "Category source")
        _ensure_category_valid_for_account(category, account, user.id)

        currency = currencies[account.currency]
        amount = parse_import_amount_to_minor_units(row.amount, currency)
        merchant = await _get_or_create_merchant(db, user.id, row.merchant_name, merchant_cache, stats)
        tags = await _get_or_create_tags(db, user.id, row.tag_names, tag_cache, stats)

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


async def _resolve_categories(
    db: AsyncSession,
    user: User,
    mappings: list[TransactionImportCategoryMapping],
    stats: ImportStats,
) -> dict[str, Category]:
    category_map: dict[str, Category] = {}
    for mapping in mappings:
        source = strip_import_text_or_raise(mapping.source, "Category source")
        if source in category_map:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Duplicate category source: {source}")
        if (mapping.category_id is None) == (mapping.create is None):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Category source must map to exactly one category action: {source}",
            )

        if mapping.category_id is not None:
            category = await _get_accessible_category(db, mapping.category_id, user.id)
            stats.categories_reused += 1
        else:
            category = await _get_or_create_personal_category(db, user.id, mapping.create, stats)

        category_map[source] = category
    return category_map


async def _get_accessible_category(db: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID) -> Category:
    group_ids = select(GroupMember.group_id).where(GroupMember.user_id == user_id).scalar_subquery()
    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None)))
            | (Category.group_id.in_(group_ids)),
        ),
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return category


async def _get_or_create_personal_category(db: AsyncSession, user_id: uuid.UUID, create, stats: ImportStats) -> Category:
    kind = _parse_category_kind(create.kind)
    name = strip_import_text_or_raise(create.name, "Category name")
    result = await db.execute(
        select(Category)
        .where(
            Category.name == name,
            Category.is_system.is_(True) | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )
        .order_by(Category.is_system.asc())
        .limit(1),
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        if existing.kind != kind:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Category with this name already exists with a different type: {name}",
            )
        stats.categories_reused += 1
        return existing

    category = Category(
        owner_id=user_id,
        group_id=None,
        name=name,
        kind=kind,
        icon=create.icon,
    )
    db.add(category)
    await db.flush()
    stats.categories_created += 1
    stats.created_category_ids.append(category.id)
    return category


async def _load_currencies(db: AsyncSession, currency_ids: set[str]) -> dict[str, Currency]:
    result = await db.execute(select(Currency).where(Currency.id.in_(currency_ids)))
    currencies = {currency.id: currency for currency in result.scalars().all()}
    missing = currency_ids - currencies.keys()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Invalid currency code: {sorted(missing)[0]}",
        )
    return currencies


async def _load_personal_merchants(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Merchant]:
    result = await db.execute(select(Merchant).where(Merchant.owner_id == user_id, Merchant.group_id.is_(None)))
    return {merchant.name: merchant for merchant in result.scalars().all()}


async def _get_or_create_merchant(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_name: str | None,
    cache: dict[str, Merchant],
    stats: ImportStats,
) -> Merchant | None:
    name = raw_name.strip() if raw_name else ""
    if not name:
        return None
    if len(name) > 256:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Merchant name is too long: {name[:28]}")

    existing = cache.get(name)
    if existing is not None:
        stats.merchants_reused += 1
        return existing

    merchant = Merchant(owner_id=user_id, group_id=None, name=name, default_category_id=None)
    db.add(merchant)
    await db.flush()
    cache[name] = merchant
    stats.merchants_created += 1
    stats.created_merchant_ids.append(merchant.id)
    return merchant


async def _load_personal_tags(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Tag]:
    result = await db.execute(select(Tag).where(Tag.owner_id == user_id, Tag.group_id.is_(None)))
    return {tag.name: tag for tag in result.scalars().all()}


async def _get_or_create_tags(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_names: list[str],
    cache: dict[str, Tag],
    stats: ImportStats,
) -> list[Tag]:
    tags: list[Tag] = []
    seen: set[str] = set()
    for raw_name in raw_names:
        name = raw_name.strip()
        if not name or name in seen:
            continue
        if len(name) > 64:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Tag name is too long: {name[:28]}")

        tag = cache.get(name)
        if tag is not None:
            stats.tags_reused += 1
        else:
            tag = Tag(owner_id=user_id, group_id=None, name=name)
            db.add(tag)
            await db.flush()
            cache[name] = tag
            stats.tags_created += 1
            stats.created_tag_ids.append(tag.id)

        tags.append(tag)
        seen.add(name)
    return tags


def _ensure_category_valid_for_account(category: Category, account: Account, user_id: uuid.UUID) -> None:
    if category.is_system or (category.owner_id == user_id and category.group_id is None) or category.group_id == account.group_id:
        return
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")


def _get_required(mapping: dict[str, Account] | dict[str, Category], source: str, label: str):
    value = mapping.get(source)
    if value is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} is not mapped: {source}")
    return value


def _parse_category_kind(value: str) -> CategoryKind:
    try:
        return CategoryKind(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid category kind") from exc
