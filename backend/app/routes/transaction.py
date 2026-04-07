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
from app.models.account import Account, AccountPermission
from app.models.base import PermissionLevel
from app.models.category import Category
from app.models.currency import Currency
from app.models.household import HouseholdMember
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access, check_transaction_access
from app.schemas.transaction import CreateTransactionRequest, TransactionResponse, UpdateTransactionRequest
from app.services.snapshots import recompute_snapshots_from

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



async def _check_category_access_or_422(
    db: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID, household_id: uuid.UUID | None = None,
) -> None:
    """Validate a category exists and is accessible (personal or same household)."""
    query = select(Category).where(Category.id == category_id)
    if household_id is not None:
        query = query.where((Category.owner_id == user_id) | (Category.household_id == household_id))
    else:
        query = query.where(Category.owner_id == user_id)
    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")


async def _check_merchant_access_or_422(
    db: AsyncSession, merchant_id: uuid.UUID, user_id: uuid.UUID, household_id: uuid.UUID | None = None,
) -> None:
    """Validate a merchant exists and is accessible (personal or same household)."""
    query = select(Merchant).where(Merchant.id == merchant_id)
    if household_id is not None:
        query = query.where((Merchant.owner_id == user_id) | (Merchant.household_id == household_id))
    else:
        query = query.where(Merchant.owner_id == user_id)
    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Merchant not found")


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
    data = TransactionResponse.model_validate(txn)
    data.tag_ids = tag_ids
    return data


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

    # Subquery: all account IDs the user can access (personal, household admin, or explicit permission)
    accessible_accounts = (
        select(Account.id)
        .outerjoin(HouseholdMember, Account.household_id == HouseholdMember.household_id)
        .outerjoin(
            AccountPermission,
            (AccountPermission.account_id == Account.id) & (AccountPermission.user_id == user.id),
        )
        .where(
            (Account.owner_id == user.id)
            | ((HouseholdMember.user_id == user.id) & (HouseholdMember.is_admin.is_(True)))
            | (AccountPermission.user_id == user.id),
        )
    ).scalar_subquery()

    query = select(Transaction).where(Transaction.account_id.in_(accessible_accounts))

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
    """Return a single transaction by ID. Requires read access on the parent account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.READ)
    tag_ids = await _get_tag_ids(db, txn.id)
    return _build_response(txn, tag_ids)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: CreateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new transaction. Requires write access on the target account."""
    account = await check_account_access(
        db, data.account_id, user.id, PermissionLevel.WRITE, require_open=True,
    )

    currency_lookup = await db.execute(select(Currency).where(Currency.id == data.currency))
    if not currency_lookup.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    if data.currency != account.currency and data.fx_rate is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="fx_rate is required when transaction currency differs from account currency",
        )

    await _check_category_access_or_422(db, data.category_id, user.id, account.household_id)
    if data.merchant_id:
        await _check_merchant_access_or_422(db, data.merchant_id, user.id, account.household_id)
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

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, data.account_id, data.ts)

    await db.commit()
    await db.refresh(txn)

    tag_ids = await _get_tag_ids(db, txn.id)
    return _build_response(txn, tag_ids)


@router.patch("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a transaction. Requires write access on the target account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        tag_ids = await _get_tag_ids(db, txn.id)
        return _build_response(txn, tag_ids)

    # Capture pre-change values needed to recompute balance snapshots
    old_account_id = txn.account_id
    old_ts = txn.ts

    # Resolve the account's household_id for category/merchant validation
    account_household_id = None
    if "account_id" in changed_fields:
        # Moving to a new account — check write access and reject closed targets
        new_account = await check_account_access(
            db, changed_fields["account_id"], user.id, PermissionLevel.WRITE, require_open=True,
        )
        account_household_id = new_account.household_id
        if txn.currency != new_account.currency and txn.fx_rate is None and "fx_rate" not in changed_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="fx_rate is required when transaction currency differs from account currency",
            )
    else:
        # Staying on the same account — look up its household_id
        current_account = (await db.execute(select(Account).where(Account.id == txn.account_id))).scalar_one()
        account_household_id = current_account.household_id

    if "category_id" in changed_fields:
        await _check_category_access_or_422(db, changed_fields["category_id"], user.id, account_household_id)
    if "merchant_id" in changed_fields and changed_fields["merchant_id"] is not None:
        await _check_merchant_access_or_422(db, changed_fields["merchant_id"], user.id, account_household_id)

    # Snapshot recomputation is only needed when balance-affecting fields change
    recompute_needed = bool({"account_id", "ts", "amount"} & changed_fields.keys())

    # Handle tags separately — validate and replace in bulk
    new_tag_ids = changed_fields.pop("tag_ids", None)

    for field, value in changed_fields.items():
        setattr(txn, field, value)

    if new_tag_ids is not None:
        validated = await _validate_tag_ids(db, user.id, new_tag_ids) if new_tag_ids else []
        await _replace_tags(db, txn.id, validated)

    if recompute_needed:
        await db.flush()
        if txn.account_id != old_account_id:
            # Account moved — recompute both sides from their respective affected days
            await recompute_snapshots_from(db, old_account_id, old_ts)
            await recompute_snapshots_from(db, txn.account_id, txn.ts)
        else:
            # Same account — recompute from the earliest affected day
            await recompute_snapshots_from(db, txn.account_id, min(old_ts, txn.ts))

    await db.commit()
    await db.refresh(txn)

    tag_ids = await _get_tag_ids(db, txn.id)
    return _build_response(txn, tag_ids)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a transaction. Requires write access on the parent account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)

    # Capture pre-delete values for snapshot recomputation
    account_id = txn.account_id
    deleted_ts = txn.ts

    # Delete junction rows before the transaction itself
    await db.execute(
        sa.delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
    await db.delete(txn)
    await db.flush()

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, account_id, deleted_ts)

    await db.commit()
