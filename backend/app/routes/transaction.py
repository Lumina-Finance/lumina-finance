import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import MappedColumn

from app.database import get_db
from app.dependencies import get_current_user
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import TransactionResponse

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


def _to_response(txn: Transaction, tag_ids: list[uuid.UUID]) -> TransactionResponse:
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
    return [_to_response(txn, tag_map[txn.id]) for txn in transactions]
