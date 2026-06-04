import re
import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import ACCOUNT_KIND_BY_TYPE, AccountType, CategoryKind, PermissionLevel
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.institution import Institution
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import (
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
    TransactionImportRequest,
    TransactionImportResponse,
)
from app.services.snapshots import recompute_snapshots_from

_RAW_AMOUNT_RE = re.compile(r"^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$")


@dataclass
class _ImportStats:
    accounts_created: int = 0
    accounts_reused: int = 0
    categories_created: int = 0
    categories_reused: int = 0
    merchants_created: int = 0
    merchants_reused: int = 0
    tags_created: int = 0
    tags_reused: int = 0
    created_account_ids: list[uuid.UUID] = field(default_factory=list)
    created_category_ids: list[uuid.UUID] = field(default_factory=list)
    created_merchant_ids: list[uuid.UUID] = field(default_factory=list)
    created_tag_ids: list[uuid.UUID] = field(default_factory=list)


async def import_transactions(
    db: AsyncSession,
    user: User,
    data: TransactionImportRequest,
) -> TransactionImportResponse:
    """Create transactions from a frontend-compiled import payload."""
    stats = _ImportStats()
    account_map = await _resolve_accounts(db, user, data.accounts, stats)
    category_map = await _resolve_categories(db, user, data.categories, stats)
    currencies = await _load_currencies(db, {account.currency for account in account_map.values()})
    merchant_cache = await _load_personal_merchants(db, user.id)
    tag_cache = await _load_personal_tags(db, user.id)
    affected_from: dict[uuid.UUID, date] = {}

    for row in data.rows:
        account = _get_required(account_map, _clean_required(row.account_source, "Account source"), "Account source")
        category = _get_required(category_map, _clean_required(row.category_source, "Category source"), "Category source")
        _ensure_category_valid_for_account(category, account, user.id)

        currency = currencies[account.currency]
        amount = _parse_amount_to_minor_units(row.amount, currency)
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
        account_source_ids={source: account.id for source, account in account_map.items()},
        category_source_ids={source: category.id for source, category in category_map.items()},
        created_account_ids=stats.created_account_ids,
        created_category_ids=stats.created_category_ids,
        created_merchant_ids=stats.created_merchant_ids,
        created_tag_ids=stats.created_tag_ids,
    )


async def _resolve_accounts(
    db: AsyncSession,
    user: User,
    mappings: list[TransactionImportAccountMapping],
    stats: _ImportStats,
) -> dict[str, Account]:
    account_map: dict[str, Account] = {}
    for mapping in mappings:
        source = _clean_required(mapping.source, "Account source")
        if source in account_map:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Duplicate account source: {source}")
        if (mapping.account_id is None) == (mapping.create is None):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Account source must map to exactly one account action: {source}",
            )

        if mapping.account_id is not None:
            account = await check_account_access(db, mapping.account_id, user.id, PermissionLevel.WRITE, require_open=True)
            stats.accounts_reused += 1
        else:
            account = await _create_import_account(db, user, mapping.create)
            stats.accounts_created += 1
            stats.created_account_ids.append(account.id)

        account_map[source] = account
    return account_map


async def _create_import_account(db: AsyncSession, user: User, create) -> Account:
    account_type = _parse_account_type(create.account_type)
    currency = create.currency.upper()
    if not await _currency_exists(db, currency):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid currency code: {currency}")
    if create.institution_id and not await _institution_exists(db, create.institution_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")

    account = Account(
        owner_id=user.id,
        group_id=None,
        account_kind=ACCOUNT_KIND_BY_TYPE[account_type],
        account_type=account_type,
        tax_advantaged_plan_id=None,
        name=_clean_required(create.name, "Account name"),
        institution_id=create.institution_id,
        currency=currency,
        credit_limit=None,
        is_archived=False,
    )
    db.add(account)
    await db.flush()
    db.add(AccountBalanceSnapshot(
        account_id=account.id,
        dt=account.created_at.astimezone(ZoneInfo(user.tz)).date(),
        balance=0,
    ))
    return account


async def _resolve_categories(
    db: AsyncSession,
    user: User,
    mappings: list[TransactionImportCategoryMapping],
    stats: _ImportStats,
) -> dict[str, Category]:
    category_map: dict[str, Category] = {}
    for mapping in mappings:
        source = _clean_required(mapping.source, "Category source")
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


async def _get_or_create_personal_category(db: AsyncSession, user_id: uuid.UUID, create, stats: _ImportStats) -> Category:
    kind = _parse_category_kind(create.kind)
    name = _clean_required(create.name, "Category name")
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


async def _currency_exists(db: AsyncSession, currency: str) -> bool:
    return (await db.execute(select(Currency.id).where(Currency.id == currency))).scalar_one_or_none() is not None


async def _institution_exists(db: AsyncSession, institution_id: uuid.UUID) -> bool:
    result = await db.execute(select(Institution.id).where(Institution.id == institution_id))
    return result.scalar_one_or_none() is not None


async def _load_personal_merchants(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Merchant]:
    result = await db.execute(select(Merchant).where(Merchant.owner_id == user_id, Merchant.group_id.is_(None)))
    return {merchant.name: merchant for merchant in result.scalars().all()}


async def _get_or_create_merchant(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_name: str | None,
    cache: dict[str, Merchant],
    stats: _ImportStats,
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
    stats: _ImportStats,
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


def _parse_amount_to_minor_units(raw_amount: str, currency: Currency) -> int:
    normalized = raw_amount.strip()
    if not _RAW_AMOUNT_RE.fullmatch(normalized):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid amount: {raw_amount}")

    try:
        amount = Decimal(normalized.replace(",", ""))
    except InvalidOperation as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid amount: {raw_amount}") from exc

    multiplier = Decimal(10) ** currency.minor_unit_exponent
    minor_units = amount * multiplier
    if minor_units != minor_units.to_integral_value():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Amount has too many decimal places for {currency.id}: {raw_amount}",
        )
    return int(minor_units)


def _ensure_category_valid_for_account(category: Category, account: Account, user_id: uuid.UUID) -> None:
    if category.is_system or (category.owner_id == user_id and category.group_id is None) or category.group_id == account.group_id:
        return
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")


def _get_required(mapping: dict[str, Account] | dict[str, Category], source: str, label: str):
    value = mapping.get(source)
    if value is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} is not mapped: {source}")
    return value


def _parse_account_type(value: str) -> AccountType:
    try:
        return AccountType(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account type") from exc


def _parse_category_kind(value: str) -> CategoryKind:
    try:
        return CategoryKind(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid category kind") from exc


def _clean_required(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} cannot be blank")
    return cleaned
