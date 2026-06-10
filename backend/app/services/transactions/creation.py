"""Transaction creation service"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import CreateTransactionRequest, TransactionResponse
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.snapshots import recompute_snapshots_from
from app.services.transactions.accounts import validate_transaction_account_is_not_archived
from app.services.transactions.response_helpers import get_transaction_response
from app.services.transactions.tags import replace_transaction_tag_assignments
from app.services.transactions.validation import (
    get_valid_transaction_tag_ids,
    validate_transaction_category_access,
    validate_transaction_currency_exists,
    validate_transaction_fx_rate_for_account_currency,
    validate_transaction_merchant_access,
)


async def create_transaction_and_get_response(
    db: AsyncSession,
    user: User,
    data: CreateTransactionRequest,
) -> TransactionResponse:
    """Create a transaction and return its API response

    The service validates account write access, related transaction entities,
    and currency requirements before inserting the transaction, updating tag
    associations, recalculating snapshots, and marking the affected cache scope

    Args:
        db: Active database session
        user: Authenticated user creating the transaction
        data: Transaction creation payload

    Returns:
        Newly created transaction response with related display data
    """
    # Load the target account and verify the user can write new transactions to it
    account = await check_account_access(
        db,
        data.account_id,
        user.id,
        PermissionLevel.WRITE,
        require_open=True,
    )
    validate_transaction_account_is_not_archived(account)

    # Check currency and account currency inputs before any transaction row is inserted
    await validate_transaction_currency_exists(db, data.currency)
    validate_transaction_fx_rate_for_account_currency(data.currency, account.currency, data.fx_rate)

    # Confirm related records belong to the same accessible group as the account
    await validate_transaction_category_access(db, data.category_id, user.id, account.group_id)
    if data.merchant_id:
        await validate_transaction_merchant_access(db, data.merchant_id, user.id, account.group_id)
    validated_tag_ids = []
    if data.tag_ids:
        validated_tag_ids = await get_valid_transaction_tag_ids(db, user.id, data.tag_ids, account.group_id)

    # Insert the transaction first so optional tag assignments can reference its id
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

    # Write optional tag assignments after the transaction id and tag ids are known
    if validated_tag_ids:
        await replace_transaction_tag_assignments(db, txn.id, validated_tag_ids)

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, data.account_id, data.dt)

    # Mark the affected user or group cache after all transaction writes are flushed
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()

    # Reload generated database fields before building the response
    await db.refresh(txn)

    # Load related merchant and tag display data for the public API shape
    return await get_transaction_response(db, txn)
