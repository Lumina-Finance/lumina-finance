"""Transaction update service"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_account_access, check_transaction_access
from app.schemas.transaction import TransactionResponse, UpdateTransactionRequest
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.transactions.accounts import (
    get_parent_account_for_transaction,
    validate_transaction_account_is_not_archived,
)
from app.services.transactions.response_helpers import get_transaction_response
from app.services.transactions.snapshots import recompute_snapshots_after_transaction_update
from app.services.transactions.tags import replace_transaction_tag_assignments
from app.services.transactions.validation import (
    get_valid_transaction_tag_ids,
    validate_transaction_category_access,
    validate_transaction_fx_rate_for_account_currency,
    validate_transaction_merchant_access,
)


async def update_transaction_and_get_response(
    db: AsyncSession,
    user: User,
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
) -> TransactionResponse:
    """Update a transaction and return its API response

    The service checks write access, validates account and related entity
    changes, applies requested field updates, replaces tag assignments when
    supplied, recalculates affected snapshots, marks changed cache scopes, and returns
    the enriched transaction response

    Args:
        db: Active database session
        user: Authenticated user updating the transaction
        transaction_id: Transaction identifier from the route path
        data: Partial transaction update payload

    Returns:
        Updated transaction response with related display data
    """
    # Load the transaction through the access helper so only writable rows can be updated
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)

    # Load the persisted parent account for archive validation and cache scope updates
    current_account = await get_parent_account_for_transaction(db, txn)
    validate_transaction_account_is_not_archived(current_account)

    changed_fields = data.model_dump(exclude_unset=True)

    # Load related response data without writing when the request contains no changes
    if not changed_fields:
        return await get_transaction_response(db, txn)

    previous_account_id = txn.account_id
    previous_date = txn.dt
    new_account = None

    account_group_id = current_account.group_id

    # Load the target account and verify it can receive transaction history when the transaction is moved
    if "account_id" in changed_fields:
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

    # Confirm changed category and merchant records belong to the selected account group
    if "category_id" in changed_fields:
        await validate_transaction_category_access(db, changed_fields["category_id"], user.id, account_group_id)
    if "merchant_id" in changed_fields and changed_fields["merchant_id"] is not None:
        await validate_transaction_merchant_access(db, changed_fields["merchant_id"], user.id, account_group_id)

    # Handle tags outside the model field loop because they live in a junction table
    new_tag_ids = changed_fields.pop("tag_ids", None)

    for field, value in changed_fields.items():
        setattr(txn, field, value)

    # Validate requested tags before replacing junction rows
    if new_tag_ids is not None:
        validated_tag_ids = (
            await get_valid_transaction_tag_ids(db, user.id, new_tag_ids, account_group_id) if new_tag_ids else []
        )
        await replace_transaction_tag_assignments(db, txn.id, validated_tag_ids)

    # Flush row and tag changes before rebuilding any affected balance snapshots
    await recompute_snapshots_after_transaction_update(
        db,
        txn,
        previous_account_id=previous_account_id,
        previous_date=previous_date,
        changed_fields=changed_fields,
    )

    # Mark cache scopes for the original account and the new account when moved
    await mark_cache_changed_for_scope(db, user_id=current_account.owner_id, group_id=current_account.group_id)
    if new_account is not None and new_account.id != current_account.id:
        await mark_cache_changed_for_scope(db, user_id=new_account.owner_id, group_id=new_account.group_id)

    await db.commit()

    # Reload generated database fields before building the response
    await db.refresh(txn)

    # Load related merchant and tag display data for the public API shape
    return await get_transaction_response(db, txn)
