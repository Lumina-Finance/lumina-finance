"""Transaction deletion service"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.transaction import BulkDeleteTransactionsRequest, BulkDeleteTransactionsResponse
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.bank_sync.manual_entries import lock_bank_imports, refuse_deleting_bank_imports
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.transactions.accounts import (
    get_parent_account_for_transaction,
    validate_transaction_account_is_not_archived,
)
from app.services.transactions.bulk_access import load_locked_transactions, load_writable_accounts
from app.services.transactions.tags import delete_transaction_tag_assignments


async def delete_transaction_for_user(
    db: AsyncSession,
    user: User,
    transaction_id: uuid.UUID,
) -> None:
    """Delete one transaction after checking write access

    The service loads the writable transaction, refuses it while it is bank-imported into a linked
    account, deletes it, marks the cache scope changed and commits. Its refund link, if any, goes
    with it and the transaction on the other side stays. Deleting both is a bulk delete that
    chooses the linked ones

    Args:
        db: Active database session
        user: Authenticated user deleting the transaction
        transaction_id: Transaction identifier from the route path

    Returns:
        None

    Raises:
        HTTPException 422: The transaction is bank-imported and its account is linked
    """
    # The delete takes a bank-imported transaction's bank transaction with it, and that is locked first
    await lock_bank_imports(db, [transaction_id])

    # Take the same row lock before tag deletion so an edit and delete cannot interleave
    txn = await check_transaction_access(
        db,
        transaction_id,
        user.id,
        PermissionLevel.WRITE,
        lock_for_update=True,
    )
    await refuse_deleting_bank_imports(db, [txn])
    account = await delete_transaction(db, txn)

    # Mark the affected user or group cache after all delete writes are flushed
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)

    # Commit tag deletion, transaction deletion, snapshot updates, and cache updates together
    await db.commit()


async def delete_transaction(db: AsyncSession, txn: Transaction) -> Account:
    """Delete a transaction with its tag assignments and rebuild its account's balances, without committing

    The caller marks the returned account's cache last and commits, so the deletion can be one step
    of a larger save. A bank-imported transaction is deleted whether or not its account is linked,
    so a bank removal the user approves applies while the account stays linked. A delete the user
    asks for directly refuses that first

    Args:
        db: Active database session
        txn: The transaction, locked and checked writable by the caller

    Returns:
        The account the transaction was in
    """
    # Load the parent account for archive validation and cache scope updates
    account = await get_parent_account_for_transaction(db, txn)
    validate_transaction_account_is_not_archived(account)

    account_id = txn.account_id
    deleted_dt = txn.dt
    await delete_transaction_row(db, txn)

    # Rebuild balance snapshots from the deleted transaction's day forward
    await recompute_account_snapshots(db, {account_id: deleted_dt})
    return account


async def delete_transaction_row(db: AsyncSession, txn: Transaction) -> None:
    """Delete a transaction with its tag assignments, leaving its account's balances for the caller to rebuild

    A save that changes ledger rows in several accounts rebuilds them all in one step. That step takes
    their balance locks in one order, so two such saves can't each hold a lock the other waits for

    Args:
        db: Active database session
        txn: The transaction, locked by the caller
    """
    # Remove tag assignments before deleting the transaction row in the same commit
    await delete_transaction_tag_assignments(db, txn.id)

    # Delete the transaction row and flush before rebuilding dependent snapshots
    await db.delete(txn)
    await db.flush()


async def bulk_delete_transactions(
    db: AsyncSession,
    user: User,
    data: BulkDeleteTransactionsRequest,
) -> BulkDeleteTransactionsResponse:
    """Delete several transactions at once, all of them or none

    Every rule single delete enforces is enforced on every row, and a set holding one row that
    refuses is refused whole. The rows are locked, their accounts checked for write access and
    archiving, any bank-imported row in a linked account refused, their tag assignments and the
    rows removed, and the balances rebuilt from each account's earliest deleted day, all in one
    commit

    Args:
        db: Active database session
        user: Authenticated user deleting the transactions
        data: Transactions to delete

    Returns:
        The count of rows deleted and the accounts they were in

    Raises:
        HTTPException: A transaction was not found, an account refuses the write, an account
            belongs to a group, a bank-imported transaction's account is linked, or another change
            reached one of the transactions first
    """
    requested_ids = list(dict.fromkeys(data.transaction_ids))
    await lock_bank_imports(db, requested_ids)
    transactions = await load_locked_transactions(db, user, requested_ids)
    accounts = await load_writable_accounts(db, user, {t.account_id for t in transactions})
    _refuse_grouped_accounts(accounts)
    await refuse_deleting_bank_imports(db, transactions, in_bulk=True)

    await delete_locked_transactions(
        db,
        Transaction.id.in_(requested_ids),
        [(transaction.account_id, transaction.dt) for transaction in transactions],
    )
    await mark_accounts_changed(db, accounts)
    await db.commit()

    return BulkDeleteTransactionsResponse(
        transactions_deleted=len(transactions),
        affected_account_ids=[account.id for account in accounts],
    )


async def delete_locked_transactions(
    db: AsyncSession,
    condition: ColumnElement[bool],
    deleted_days: list[tuple[uuid.UUID, date]],
) -> None:
    """Delete transactions the caller has already locked and checked, without committing or marking the cache

    Their tag assignments and the rows go by the condition rather than by an id list, so a set of
    any size is two statements. The balances are rebuilt from each account's earliest deleted day.
    The caller marks the accounts changed once its other writes are done, so the cache rows are the
    last locks it takes, as every ledger write takes them

    Args:
        db: Active database session
        condition: Selects exactly the locked transactions
        deleted_days: The account and date of each deleted transaction

    Returns:
        None
    """
    snapshot_starts: dict[uuid.UUID, date] = {}
    for account_id, dt in deleted_days:
        current = snapshot_starts.get(account_id)
        if current is None or dt < current:
            snapshot_starts[account_id] = dt

    await db.execute(
        delete(TransactionTag).where(TransactionTag.transaction_id.in_(select(Transaction.id).where(condition))),
    )
    await db.execute(delete(Transaction).where(condition))
    await db.flush()

    await recompute_account_snapshots(db, snapshot_starts)


async def mark_accounts_changed(db: AsyncSession, accounts: list[Account]) -> None:
    """Mark the cache of each scope these accounts are in changed, without committing

    Args:
        db: Active database session
        accounts: The accounts a write changed

    Returns:
        None
    """
    # One mark per scope rather than one per account, since every account in a scope shares it
    for owner_id, group_id in {(account.owner_id, account.group_id) for account in accounts}:
        await mark_cache_changed_for_scope(db, user_id=owner_id, group_id=group_id)


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
