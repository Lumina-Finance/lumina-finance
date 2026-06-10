"""Transaction deletion service"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_transaction_access
from app.services.accounts.snapshots import recompute_snapshots_from
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.transactions.accounts import (
    get_parent_account_for_transaction,
    validate_transaction_account_is_not_archived,
)
from app.services.transactions.tags import delete_transaction_tag_assignments


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
    # Load the transaction through the access helper so only writable rows can be deleted
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)

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
    await recompute_snapshots_from(db, account_id, deleted_dt)

    # Mark the affected user or group cache after all delete writes are flushed
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)

    # Commit tag deletion, transaction deletion, snapshot updates, and cache updates together
    await db.commit()
