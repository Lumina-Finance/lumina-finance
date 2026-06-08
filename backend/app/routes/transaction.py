"""Transaction API routes."""
import uuid
from datetime import date
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import MappedColumn

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access, check_transaction_access
from app.schemas.transaction import (
    CreateTransactionRequest,
    TransactionImportRequest,
    TransactionImportResponse,
    TransactionResponse,
    TransactionsOverview,
    UpdateTransactionRequest,
)
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.fx import FxConverter
from app.services.snapshots import recompute_snapshots_from
from app.services.transaction_imports import import_transactions
from app.services.transaction_responses import (
    build_transaction_response,
    get_merchant_names_batch,
    get_tag_ids,
    get_tag_ids_batch,
    get_tags_batch,
)
from app.services.transactions.access import accessible_account_ids_subquery
from app.services.transactions.overview import get_transactions_overview as get_transactions_overview_response

router = APIRouter(prefix="/transactions", tags=["transactions"])

# Sortable fields mapped to their SQLAlchemy column objects
_SORT_FIELDS: dict[str, MappedColumn] = {
    "dt": Transaction.dt,
    "amount": Transaction.amount,
    "created_at": Transaction.created_at,
    "updated_at": Transaction.updated_at,
}

# Filter fields mapped to their SQLAlchemy column objects
_FILTER_FIELDS: dict[str, MappedColumn] = {
    "account_id": Transaction.account_id,
    "category_id": Transaction.category_id,
    "merchant_id": Transaction.merchant_id,
    "currency": Transaction.currency,
}


def _escape_like(value: str) -> str:
    """Escape LIKE-special characters so user input is matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _transaction_tag_sort_subquery():
    tag_name = sa.func.lower(Tag.name)
    return (
        select(
            TransactionTag.transaction_id,
            sa.func.string_agg(
                tag_name,
                aggregate_order_by(",", tag_name),
            ).label("tag_names"),
        )
        .join(Tag, Tag.id == TransactionTag.tag_id)
        .group_by(TransactionTag.transaction_id)
        .subquery()
    )


def _date_sort_order(sort_order: str, tag_names):
    date_order = Transaction.dt.desc() if sort_order == "desc" else Transaction.dt.asc()
    created_order = Transaction.created_at.desc() if sort_order == "desc" else Transaction.created_at.asc()
    return (
        date_order,
        created_order,
        Transaction.amount.asc(),
        sa.func.lower(Category.name).asc(),
        sa.func.lower(sa.func.coalesce(Merchant.name, "")).asc(),
        sa.func.lower(sa.func.coalesce(Transaction.notes, "")).asc(),
        sa.func.coalesce(tag_names, "").asc(),
        Transaction.id,
    )


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _get_accounts_by_id(db: AsyncSession, account_ids: set[uuid.UUID]) -> dict[uuid.UUID, Account]:
    accounts = (
        (await db.execute(select(Account).where(Account.id.in_(account_ids)))).scalars().all()
        if account_ids
        else []
    )
    return {account.id: account for account in accounts}


async def _get_transaction_response_context(
    db: AsyncSession,
    transactions: list[Transaction],
    *,
    extra_currencies: set[str] | None = None,
) -> tuple[dict[uuid.UUID, Account], dict[str, int]]:
    account_by_id = await _get_accounts_by_id(db, {txn.account_id for txn in transactions})
    currencies = {
        txn.currency
        for txn in transactions
    } | {
        account.currency
        for account in account_by_id.values()
    } | (extra_currencies or set())
    return account_by_id, await _get_currency_exponents(db, currencies)


async def _prefetch_transaction_response_rates(
    converter: FxConverter,
    *,
    transactions: list[Transaction],
    account_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> None:
    if not transactions:
        return

    start = min(txn.dt for txn in transactions)
    end = max(txn.dt for txn in transactions)
    pairs = {
        (txn.currency, quote)
        for txn in transactions
        for quote in (account_by_id[txn.account_id].currency, base_currency)
        if txn.currency != quote
    }
    for base, quote in sorted(pairs):
        await converter.prefetch_rates(
            base=base,
            quote=quote,
            start_date=start,
            end_date=end,
        )


async def _check_category_access_or_422(
    db: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID, group_id: uuid.UUID | None = None,
) -> None:
    """Validate a category exists and is accessible for the account scope."""
    query = select(Category).where(Category.id == category_id)
    if group_id is not None:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None)))
            | (Category.group_id == group_id),
        )
    else:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )
    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")


async def _check_merchant_access_or_422(
    db: AsyncSession, merchant_id: uuid.UUID, user_id: uuid.UUID, group_id: uuid.UUID | None = None,
) -> None:
    """Validate a merchant exists and is accessible (personal or same group)."""
    query = select(Merchant).where(Merchant.id == merchant_id)
    if group_id is not None:
        query = query.where(
            ((Merchant.owner_id == user_id) & (Merchant.group_id.is_(None))) | (Merchant.group_id == group_id),
        )
    else:
        query = query.where(Merchant.owner_id == user_id, Merchant.group_id.is_(None))
    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Merchant not found")


async def _validate_tag_ids(
    db: AsyncSession, user_id: uuid.UUID, tag_ids: list[uuid.UUID], group_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Validate all tag IDs are accessible in the transaction account scope."""
    # Deduplicate to avoid inserting duplicate junction rows (composite PK violation)
    unique_ids = list(dict.fromkeys(tag_ids))
    tag_filter = (Tag.owner_id == user_id) & (Tag.group_id.is_(None))
    if group_id is not None:
        tag_filter = tag_filter | (Tag.group_id == group_id)

    result = await db.execute(
        select(Tag.id).where(Tag.id.in_(unique_ids), tag_filter),
    )
    found_ids = set(result.scalars().all())
    if found_ids != set(unique_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Tag not found")
    return unique_ids


async def _replace_tags(db: AsyncSession, transaction_id: uuid.UUID, tag_ids: list[uuid.UUID]) -> None:
    """Replace all tags on a transaction with the given tag IDs."""
    await db.execute(
        sa.delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
    for tag_id in tag_ids:
        db.add(TransactionTag(transaction_id=transaction_id, tag_id=tag_id))


@router.get("/overview", response_model=TransactionsOverview)
async def get_transactions_overview(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    account_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return aggregated transaction metrics for a date range.

    Args:
        user: Authenticated user requesting the overview.
        db: Active database session.
        from_date: Optional inclusive start date for the transaction window.
        to_date: Optional inclusive end date for the transaction window.
        account_id: Optional account filter applied within the user's accessible accounts.

    Returns:
        Aggregated transaction overview metrics for the selected filters.

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``.
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
    account_id: Annotated[uuid.UUID | None, Query()] = None,
    category_id: Annotated[uuid.UUID | None, Query()] = None,
    merchant_id: Annotated[uuid.UUID | None, Query()] = None,
    currency: Annotated[str | None, Query()] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort_by: Annotated[str, Query()] = "dt",
    sort_order: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=50)] = 15,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return paginated transactions with sorting and filtering."""
    if sort_by not in _SORT_FIELDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid sort field")
    if sort_order not in ("asc", "desc"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Sort order must be 'asc' or 'desc'")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")

    sort_column = _SORT_FIELDS[sort_by]

    accessible_account_ids = accessible_account_ids_subquery(user.id)
    query = select(Transaction).where(Transaction.account_id.in_(accessible_account_ids))

    # Apply exact-match filters
    filters = {
        "account_id": account_id,
        "category_id": category_id,
        "merchant_id": merchant_id,
        "currency": currency,
    }
    for field, value in filters.items():
        if value is not None:
            query = query.where(_FILTER_FIELDS[field] == value)

    # Apply date range filters
    if from_date is not None:
        query = query.where(Transaction.dt >= from_date)
    if to_date is not None:
        query = query.where(Transaction.dt <= to_date)

    tag_sort = None
    merchant_joined = False
    if sort_by == "dt":
        tag_sort = _transaction_tag_sort_subquery()
        query = (
            query
            .join(Category, Category.id == Transaction.category_id)
            .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
            .outerjoin(tag_sort, tag_sort.c.transaction_id == Transaction.id)
        )
        merchant_joined = True

    # Text search across merchant name and notes
    if q is not None:
        pattern = f"%{_escape_like(q)}%"
        if not merchant_joined:
            query = query.outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
        query = query.where(Transaction.notes.ilike(pattern) | Merchant.name.ilike(pattern))

    if sort_by == "dt":
        query = query.order_by(*_date_sort_order(sort_order, tag_sort.c.tag_names))
    else:
        # Secondary sort by id for deterministic pagination
        order = sort_column.desc() if sort_order == "desc" else sort_column.asc()
        query = query.order_by(order, Transaction.id)
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    transactions = result.scalars().all()

    tag_map = await get_tag_ids_batch(db, [txn.id for txn in transactions])
    tag_summary_map = await get_tags_batch(db, [txn.id for txn in transactions])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id for txn in transactions])
    account_by_id, currency_exponents = await _get_transaction_response_context(
        db,
        transactions,
        extra_currencies={user.base_currency},
    )
    base_converter = FxConverter(currency_exponents=currency_exponents)
    await _prefetch_transaction_response_rates(
        base_converter,
        transactions=transactions,
        account_by_id=account_by_id,
        base_currency=user.base_currency,
    )

    account_amounts = {
        txn.id: await base_converter.convert_minor_units(
            txn.amount,
            base=txn.currency,
            quote=account_by_id[txn.account_id].currency,
            rate_date=txn.dt,
        )
        for txn in transactions
    }
    base_currency_amounts = {
        txn.id: await base_converter.convert_minor_units(
            txn.amount,
            base=txn.currency,
            quote=user.base_currency,
            rate_date=txn.dt,
        )
        for txn in transactions
    }
    return [
        build_transaction_response(
            txn,
            tag_map[txn.id],
            merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
            tag_summary_map[txn.id],
            account_amount=account_amounts[txn.id],
            base_currency_amount=base_currency_amounts[txn.id],
        )
        for txn in transactions
    ]


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single transaction by ID. Requires read access on the parent account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.READ)
    tag_ids = await get_tag_ids(db, txn.id)
    tag_summary_map = await get_tags_batch(db, [txn.id])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
    return build_transaction_response(
        txn,
        tag_ids,
        merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
        tag_summary_map[txn.id],
    )


@router.post("/import", response_model=TransactionImportResponse, status_code=status.HTTP_201_CREATED)
async def import_transaction_batch(
    data: TransactionImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Import frontend-compiled transactions and rebuild affected account snapshots once."""
    return await import_transactions(db, user, data)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: CreateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new transaction. Requires write access on the target account."""
    account = await check_account_access(
        db,
        data.account_id,
        user.id,
        PermissionLevel.WRITE,
        require_open=True,
    )
    if account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")

    currency_lookup = await db.execute(select(Currency).where(Currency.id == data.currency))
    if not currency_lookup.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    if data.currency != account.currency and data.fx_rate is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="fx_rate is required when transaction currency differs from account currency",
        )

    await _check_category_access_or_422(db, data.category_id, user.id, account.group_id)
    if data.merchant_id:
        await _check_merchant_access_or_422(db, data.merchant_id, user.id, account.group_id)
    validated_tag_ids = []
    if data.tag_ids:
        validated_tag_ids = await _validate_tag_ids(db, user.id, data.tag_ids, account.group_id)

    txn = Transaction(
        created_by_user_id=user.id,
        account_id=data.account_id,
        dt=data.dt,
        merchant_id=data.merchant_id,
        category_id=data.category_id,
        amount=data.amount,
        currency=data.currency,
        fx_rate=data.fx_rate,
        notes=data.notes,
    )
    db.add(txn)
    await db.flush()

    if validated_tag_ids:
        await _replace_tags(db, txn.id, validated_tag_ids)

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, data.account_id, data.dt)

    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
    await db.refresh(txn)

    tag_ids = await get_tag_ids(db, txn.id)
    tag_summary_map = await get_tags_batch(db, [txn.id])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
    return build_transaction_response(
        txn,
        tag_ids,
        merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
        tag_summary_map[txn.id],
    )


@router.patch("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a transaction. Requires write access on the target account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)
    current_account = (await db.execute(select(Account).where(Account.id == txn.account_id))).scalar_one()
    if current_account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        tag_ids = await get_tag_ids(db, txn.id)
        tag_summary_map = await get_tags_batch(db, [txn.id])
        merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
        return build_transaction_response(
            txn,
            tag_ids,
            merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
            tag_summary_map[txn.id],
        )

    # Capture pre-change values needed to recompute balance snapshots
    old_account_id = txn.account_id
    old_dt = txn.dt
    new_account = None

    # Resolve the account's group_id for category/merchant validation
    account_group_id = None
    if "account_id" in changed_fields:
        # Moving to a new account requires a writable target that accepts new history.
        new_account = await check_account_access(
            db,
            changed_fields["account_id"],
            user.id,
            PermissionLevel.WRITE,
            require_open=True,
        )
        if new_account.is_archived:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")
        account_group_id = new_account.group_id
        if txn.currency != new_account.currency and txn.fx_rate is None and "fx_rate" not in changed_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="fx_rate is required when transaction currency differs from account currency",
            )
    else:
        account_group_id = current_account.group_id

    if "category_id" in changed_fields:
        await _check_category_access_or_422(db, changed_fields["category_id"], user.id, account_group_id)
    if "merchant_id" in changed_fields and changed_fields["merchant_id"] is not None:
        await _check_merchant_access_or_422(db, changed_fields["merchant_id"], user.id, account_group_id)

    # Snapshot recomputation is only needed when balance-affecting fields change
    recompute_needed = bool({"account_id", "dt", "amount"} & changed_fields.keys())

    # Handle tags separately — validate and replace in bulk
    new_tag_ids = changed_fields.pop("tag_ids", None)

    for field, value in changed_fields.items():
        setattr(txn, field, value)

    if new_tag_ids is not None:
        validated = await _validate_tag_ids(db, user.id, new_tag_ids, account_group_id) if new_tag_ids else []
        await _replace_tags(db, txn.id, validated)

    if recompute_needed:
        await db.flush()
        if txn.account_id != old_account_id:
            # Account moved — recompute both sides from their respective affected days
            await recompute_snapshots_from(db, old_account_id, old_dt)
            await recompute_snapshots_from(db, txn.account_id, txn.dt)
        else:
            # Same account — recompute from the earliest affected day
            await recompute_snapshots_from(db, txn.account_id, min(old_dt, txn.dt))

    await mark_cache_changed_for_scope(db, user_id=current_account.owner_id, group_id=current_account.group_id)
    if new_account is not None and new_account.id != current_account.id:
        await mark_cache_changed_for_scope(db, user_id=new_account.owner_id, group_id=new_account.group_id)
    await db.commit()
    await db.refresh(txn)

    tag_ids = await get_tag_ids(db, txn.id)
    tag_summary_map = await get_tags_batch(db, [txn.id])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
    return build_transaction_response(
        txn,
        tag_ids,
        merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
        tag_summary_map[txn.id],
    )


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a transaction. Requires write access on the parent account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)
    account = (await db.execute(select(Account).where(Account.id == txn.account_id))).scalar_one()
    if account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")

    # Capture pre-delete values for snapshot recomputation
    account_id = txn.account_id
    deleted_dt = txn.dt

    # Delete junction rows before the transaction itself
    await db.execute(
        sa.delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
    await db.delete(txn)
    await db.flush()

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, account_id, deleted_dt)

    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
