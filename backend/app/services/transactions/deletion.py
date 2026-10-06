"""Transaction deletion service"""
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.transaction import BulkDeleteTransactionsRequest, BulkDeleteTransactionsResponse
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.transactions.accounts import (
    get_parent_account_for_transaction,
    validate_transaction_account_is_not_archived,
)
from app.services.transactions.bulk_access import load_locked_transactions, load_writable_accounts
from app.services.transactions.tags import clear_transaction_tag_assignments, delete_transaction_tag_assignments


async def delete_transaction_for_user(
    db: AsyncSession,
    user: User,
    transaction_id: uuid.UUID,
) -> None:
    """Delete one transaction after checking write access

    The service loads the writable transaction, validates its parent account,
    removes attached tag assignments, deletes the transaction row, rebuilds
    affected account snapshots, and marks the cache scope changed

    Args:
        db: Active database session
        user: Authenticated user deleting the transaction
        transaction_id: Transaction identifier from the route path

    Returns:
        None
    """
    # Take the same row lock before tag deletion so an edit and delete cannot interleave
    txn = await check_transaction_access(
        db, transaction_id, user.id, PermissionLevel.WRITE, lock_for_update=True,
    )

    # Load the parent account for archive validation and cache scope updates
    account = await get_parent_account_for_transaction(db, txn)
    validate_transaction_account_is_not_archived(account)

    account_id = txn.account_id
    deleted_dt = txn.dt

    # Remove tag assignments before deleting the transaction row in the same commit
    await delete_transaction_tag_assignments(db, transaction_id)

    # Delete the transaction row and flush before rebuilding dependent snapshots
    await db.delete(txn)
    await db.flush()

    # Rebuild balance snapshots from the deleted transaction's day forward
    await recompute_account_snapshots(db, {account_id: deleted_dt})

    # Mark the affected user or group cache after all delete writes are flushed
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)

    # Commit tag deletion, transaction deletion, snapshot updates, and cache updates together
    await db.commit()


async def bulk_delete_transactions(
    db: AsyncSession,
    user: User,
    data: BulkDeleteTransactionsRequest,
) -> BulkDeleteTransactionsResponse:
    """Delete several transactions at once, all of them or none

    Every rule single delete enforces is enforced on every row, and a set holding one row that
    refuses is refused whole. The rows are locked, their accounts checked for write access and
    archiving, their tag assignments and the rows removed, and the balances rebuilt from each
    account's earliest deleted day, all in one commit

    Args:
        db: Active database session
        user: Authenticated user deleting the transactions
        data: Transactions to delete

    Returns:
        The count of rows deleted and the accounts they were in

    Raises:
        HTTPException: A transaction was not found, an account refuses the write, an account
            belongs to a group, or another change reached one of the transactions first
    """
    requested_ids = list(dict.fromkeys(data.transaction_ids))
    transactions = await load_locked_transactions(db, user, requested_ids)
    accounts = await load_writable_accounts(db, user, {t.account_id for t in transactions})
    _refuse_grouped_accounts(accounts)

    # Each account is rebuilt from the earliest day a deleted row sat on
    snapshot_starts: dict[uuid.UUID, date] = {}
    for transaction in transactions:
        current = snapshot_starts.get(transaction.account_id)
        if current is None or transaction.dt < current:
            snapshot_starts[transaction.account_id] = transaction.dt

    await clear_transaction_tag_assignments(db, requested_ids)
    await db.execute(delete(Transaction).where(Transaction.id.in_(requested_ids)))
    await db.flush()

    await recompute_account_snapshots(db, snapshot_starts)

    # One mark per scope rather than one per transaction, since every row in a scope shares it
    for owner_id, group_id in {(account.owner_id, account.group_id) for account in accounts}:
        await mark_cache_changed_for_scope(db, user_id=owner_id, group_id=group_id)

    await db.commit()

    return BulkDeleteTransactionsResponse(
        transactions_deleted=len(transactions),
        affected_account_ids=[account.id for account in accounts],
    )


def _refuse_grouped_accounts(accounts: list[Account]) -> None:
    """Refuse a bulk delete reaching a group account

    Lumina builds for individually owned resources, so bulk delete leaves group accounts out here,
    in one place, until grouped resources are taken on

    Raises:
        HTTPException: One of the accounts belongs to a group
    """
    if any(account.group_id is not None for account in accounts):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Transactions in group accounts can't be deleted in bulk",
        )
