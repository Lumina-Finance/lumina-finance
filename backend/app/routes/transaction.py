import uuid
from datetime import datetime
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import MappedColumn

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import CreateTransactionRequest, TransactionResponse

router = APIRouter(prefix="/transactions", tags=["transactions"])

# Sortable fields mapped to their SQLAlchemy column objects
_SORT_FIELDS: dict[str, MappedColumn] = {
    "ts": Transaction.ts,
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


async def _require_owned(db: AsyncSession, model, record_id: uuid.UUID, user_id: uuid.UUID, detail: str):
    """Look up a record by ID + owner_id. Returns the record or raises 422."""
    result = await db.execute(
        select(model).where(model.id == record_id, model.owner_id == user_id),
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)
    return record


async def _validate_tag_ids(db: AsyncSession, user_id: uuid.UUID, tag_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Validate all tag IDs exist and belong to the user. Returns deduplicated list."""
    # Deduplicate to avoid inserting duplicate junction rows (composite PK violation)
    unique_ids = list(set(tag_ids))
    result = await db.execute(
        select(Tag.id).where(Tag.id.in_(unique_ids), Tag.owner_id == user_id),
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


async def _get_tag_ids(db: AsyncSession, transaction_id: uuid.UUID) -> list[uuid.UUID]:
    """Fetch tag IDs for a single transaction."""
    result = await db.execute(
        select(TransactionTag.tag_id).where(TransactionTag.transaction_id == transaction_id),
    )
    return list(result.scalars().all())


async def _get_tag_ids_batch(
    db: AsyncSession, transaction_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Fetch tag IDs for multiple transactions in a single query."""
    if not transaction_ids:
        return {}
    result = await db.execute(
        select(TransactionTag).where(TransactionTag.transaction_id.in_(transaction_ids)),
    )
    tag_map: dict[uuid.UUID, list[uuid.UUID]] = {tid: [] for tid in transaction_ids}
    for row in result.scalars().all():
        tag_map[row.transaction_id].append(row.tag_id)
    return tag_map


def _build_response(txn: Transaction, tag_ids: list[uuid.UUID]) -> TransactionResponse:
    """Build a TransactionResponse from a Transaction model and its tag IDs."""
    return TransactionResponse.model_validate(txn, update={"tag_ids": tag_ids})


@router.get("", response_model=list[TransactionResponse])
async def list_transactions(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[uuid.UUID | None, Query()] = None,
    category_id: Annotated[uuid.UUID | None, Query()] = None,
    merchant_id: Annotated[uuid.UUID | None, Query()] = None,
    currency: Annotated[str | None, Query()] = None,
    from_date: Annotated[datetime | None, Query()] = None,
    to_date: Annotated[datetime | None, Query()] = None,
    sort_by: Annotated[str, Query()] = "ts",
    sort_order: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=200)] = 15,
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
    query = select(Transaction).where(Transaction.created_by_user_id == user.id)

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
        query = query.where(Transaction.ts >= from_date)
    if to_date is not None:
        query = query.where(Transaction.ts <= to_date)

    # Secondary sort by id for deterministic pagination
    order = sort_column.desc() if sort_order == "desc" else sort_column.asc()
    query = query.order_by(order, Transaction.id).limit(limit).offset(offset)

    result = await db.execute(query)
    transactions = result.scalars().all()

    tag_map = await _get_tag_ids_batch(db, [txn.id for txn in transactions])
    return [_build_response(txn, tag_map[txn.id]) for txn in transactions]


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single transaction by ID. Must belong to the authenticated user."""
    txn_query = await db.execute(
        select(Transaction).where(Transaction.id == transaction_id, Transaction.created_by_user_id == user.id),
    )
    txn = txn_query.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    tag_ids = await _get_tag_ids(db, txn.id)
    return _build_response(txn, tag_ids)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: CreateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new transaction for the authenticated user."""
    account = await _require_owned(db, Account, data.account_id, user.id, "Account not found")

    currency_lookup = await db.execute(select(Currency).where(Currency.id == data.currency))
    if not currency_lookup.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    if data.currency != account.currency and data.fx_rate is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="fx_rate is required when transaction currency differs from account currency",
        )

    await _require_owned(db, Category, data.category_id, user.id, "Category not found")
    if data.merchant_id:
        await _require_owned(db, Merchant, data.merchant_id, user.id, "Merchant not found")
    validated_tag_ids = []
    if data.tag_ids:
        validated_tag_ids = await _validate_tag_ids(db, user.id, data.tag_ids)

    txn = Transaction(
        created_by_user_id=user.id,
        account_id=data.account_id,
        ts=data.ts,
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

    await db.commit()
    await db.refresh(txn)

    tag_ids = await _get_tag_ids(db, txn.id)
    return _build_response(txn, tag_ids)
