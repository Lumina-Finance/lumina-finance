"""Transaction API routes"""
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import PermissionLevel
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
from app.services.snapshots import recompute_snapshots_from
from app.services.transaction_imports import import_transactions
from app.services.transaction_responses import get_transaction_response
from app.services.transactions.accounts import (
    get_parent_account_for_transaction,
    validate_transaction_account_is_not_archived,
)
from app.services.transactions.listing import list_transaction_responses
from app.services.transactions.overview import get_transactions_overview as get_transactions_overview_response
from app.services.transactions.snapshots import recompute_snapshots_after_transaction_update
from app.services.transactions.tags import delete_transaction_tag_links, replace_transaction_tag_links
from app.services.transactions.validation import (
    get_valid_transaction_tag_ids,
    validate_transaction_category_access,
    validate_transaction_currency_exists,
    validate_transaction_fx_rate_for_account_currency,
    validate_transaction_merchant_access,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/overview", response_model=TransactionsOverview)
async def get_transactions_overview(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    account_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return aggregated transaction metrics for a date range

    Args:
        user: Authenticated user requesting the overview
        db: Active database session
        from_date: Optional inclusive start date for the transaction window
        to_date: Optional inclusive end date for the transaction window
        account_id: Optional account filter applied within the user's accessible accounts

    Returns:
        Aggregated transaction overview metrics for the selected filters

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
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
    search_text: Annotated[str | None, Query(alias="q", max_length=200)] = None,
    sort_by: Annotated[str, Query()] = "dt",
    sort_order: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=50)] = 15,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return paginated transactions with sorting and filtering

    Args:
        user: Authenticated user requesting transactions
        db: Active database session
        account_id: Optional account filter applied within the user's accessible accounts
        category_id: Optional category filter
        merchant_id: Optional merchant filter
        currency: Optional transaction currency filter
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text search across merchant name and notes
        sort_by: Transaction field used for ordering
        sort_order: Sort direction, either ``asc`` or ``desc``
        limit: Maximum number of transactions to return
        offset: Number of transactions to skip before returning rows

    Returns:
        Matching transaction responses for the requested page

    Raises:
        HTTPException: Raised with 422 for invalid sort fields, sort order, or
            date range
    """
    return await list_transaction_responses(
        db,
        user,
        account_id=account_id,
        category_id=category_id,
        merchant_id=merchant_id,
        currency=currency,
        from_date=from_date,
        to_date=to_date,
        search_text=search_text,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return one transaction after checking account read access

    The route resolves the transaction through the access helper, then loads
    tags and merchant names required by the public response shape

    Args:
        transaction_id: Transaction identifier from the route path
        user: Authenticated user requesting the transaction
        db: Active database session

    Returns:
        Transaction response enriched with tag and merchant display data
    """
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.READ)
    return await get_transaction_response(db, txn)


@router.post("/import", response_model=TransactionImportResponse, status_code=status.HTTP_201_CREATED)
async def import_transaction_batch(
    data: TransactionImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Import a prepared transaction batch for the authenticated user

    The route delegates transaction validation, creation, cache invalidation,
    and affected snapshot recomputation to the import service

    Args:
        data: Prepared import payload from the frontend compiler
        user: Authenticated user running the import
        db: Active database session

    Returns:
        Import summary containing created and skipped transaction counts
    """
    return await import_transactions(db, user, data)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: CreateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a transaction after validating target account write access

    The route validates related category, merchant, tag, and currency inputs,
    inserts the transaction, updates tag links, and rebuilds affected account
    snapshots before returning the enriched response

    Args:
        data: Transaction creation payload
        user: Authenticated user creating the transaction
        db: Active database session

    Returns:
        Newly created transaction response
    """
    account = await check_account_access(
        db,
        data.account_id,
        user.id,
        PermissionLevel.WRITE,
        require_open=True,
    )
    validate_transaction_account_is_not_archived(account)

    await validate_transaction_currency_exists(db, data.currency)
    validate_transaction_fx_rate_for_account_currency(data.currency, account.currency, data.fx_rate)

    await validate_transaction_category_access(db, data.category_id, user.id, account.group_id)
    if data.merchant_id:
        await validate_transaction_merchant_access(db, data.merchant_id, user.id, account.group_id)
    validated_tag_ids = []
    if data.tag_ids:
        validated_tag_ids = await get_valid_transaction_tag_ids(db, user.id, data.tag_ids, account.group_id)

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
        await replace_transaction_tag_links(db, txn.id, validated_tag_ids)

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, data.account_id, data.dt)

    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
    await db.refresh(txn)

    return await get_transaction_response(db, txn)


@router.patch("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a transaction after checking write access

    The route applies provided fields, validates changed related entities,
    replaces tag links when requested, and recomputes balance snapshots when
    the account, date, or amount changes

    Args:
        transaction_id: Transaction identifier from the route path
        data: Partial transaction update payload
        user: Authenticated user updating the transaction
        db: Active database session

    Returns:
        Updated transaction response with current related display data
    """
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)
    current_account = await get_parent_account_for_transaction(db, txn)
    validate_transaction_account_is_not_archived(current_account)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await get_transaction_response(db, txn)

    previous_account_id = txn.account_id
    previous_date = txn.dt
    new_account = None

    # Resolve the account's group_id for category/merchant validation
    account_group_id = None
    if "account_id" in changed_fields:
        # Moving to a new account requires a writable target that accepts new history
        new_account = await check_account_access(
            db,
            changed_fields["account_id"],
            user.id,
            PermissionLevel.WRITE,
            require_open=True,
        )
        validate_transaction_account_is_not_archived(new_account)
        account_group_id = new_account.group_id
        validate_transaction_fx_rate_for_account_currency(
            txn.currency,
            new_account.currency,
            txn.fx_rate,
            fx_rate_change_requested="fx_rate" in changed_fields,
        )
    else:
        account_group_id = current_account.group_id

    if "category_id" in changed_fields:
        await validate_transaction_category_access(db, changed_fields["category_id"], user.id, account_group_id)
    if "merchant_id" in changed_fields and changed_fields["merchant_id"] is not None:
        await validate_transaction_merchant_access(db, changed_fields["merchant_id"], user.id, account_group_id)

    # Handle tags separately — validate and replace in bulk
    new_tag_ids = changed_fields.pop("tag_ids", None)

    for field, value in changed_fields.items():
        setattr(txn, field, value)

    if new_tag_ids is not None:
        validated = await get_valid_transaction_tag_ids(db, user.id, new_tag_ids, account_group_id) if new_tag_ids else []
        await replace_transaction_tag_links(db, txn.id, validated)

    await recompute_snapshots_after_transaction_update(
        db,
        txn,
        previous_account_id=previous_account_id,
        previous_date=previous_date,
        changed_fields=changed_fields,
    )

    await mark_cache_changed_for_scope(db, user_id=current_account.owner_id, group_id=current_account.group_id)
    if new_account is not None and new_account.id != current_account.id:
        await mark_cache_changed_for_scope(db, user_id=new_account.owner_id, group_id=new_account.group_id)
    await db.commit()
    await db.refresh(txn)

    return await get_transaction_response(db, txn)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a transaction after checking write access

    The route removes tag links, deletes the transaction, recomputes affected
    account snapshots from the deleted transaction date, and marks the parent
    cache scope as changed

    Args:
        transaction_id: Transaction identifier from the route path
        user: Authenticated user deleting the transaction
        db: Active database session

    Returns:
        None
    """
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)
    account = await get_parent_account_for_transaction(db, txn)
    validate_transaction_account_is_not_archived(account)

    account_id = txn.account_id
    deleted_dt = txn.dt

    await delete_transaction_tag_links(db, transaction_id)
    await db.delete(txn)
    await db.flush()

    # Rebuild balance snapshots from the deleted transaction's day forward
    await recompute_snapshots_from(db, account_id, deleted_dt)

    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
