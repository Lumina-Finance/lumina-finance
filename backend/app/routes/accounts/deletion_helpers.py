"""Account deletion helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.permissions import check_account_access
from app.services.cache_state import mark_cache_changed_for_scope

_DEADLOCK_SQLSTATE = "40P01"

# Undoing an import locks the change marker before its rows, the reverse of every other writer, so a
# delete overlapping one can still be picked to break a deadlock. The undo has given way by the
# time the delete runs again
_DELETE_ATTEMPTS = 2

# Every transaction the delete removes or the commit's foreign key check reads, in id order, without
# sending the ids back
_LOCK_ACCOUNT_TRANSACTIONS = text("""
    SELECT count(*) FROM (
        SELECT 1 FROM transactions
        WHERE account_id = :account_id OR counterparty_account_id = :account_id
        ORDER BY id
        FOR UPDATE
    ) AS locked
""")


async def delete_account_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete an account after checking admin access

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User does not have admin access, the account is already gone, or transfers elsewhere
            record this account
    """
    for attempt in range(1, _DELETE_ATTEMPTS + 1):
        try:
            await _delete_account(db, account_id, user_id)
            return
        except DBAPIError as exc:
            if attempt == _DELETE_ATTEMPTS or getattr(exc.orig, "sqlstate", None) != _DEADLOCK_SQLSTATE:
                raise
            await db.rollback()


async def _delete_account(db: AsyncSession, account_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Delete an account in one database transaction, the work of one attempt

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User does not have admin access, the account is already gone, or transfers elsewhere
            record this account
        DBAPIError: The database picked this delete to break a deadlock
    """
    account = await check_account_access(db, account_id, user_id, PermissionLevel.ADMIN)

    # Take the account's locks in the order its other writers do, so the delete only ever waits for
    # them and never holds what they wait for: a change to a transaction locks that row first, and
    # a new transaction or account change locks the account. The cache is marked last, as they do
    await db.execute(_LOCK_ACCOUNT_TRANSACTIONS, {"account_id": account_id})
    locked = await db.execute(select(Account.id).where(Account.id == account_id).with_for_update())
    if locked.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    # Tag assignments hold their transactions with a foreign key that does not cascade, so they go first,
    # as a single transaction delete takes them
    await db.execute(
        delete(TransactionTag).where(
            TransactionTag.transaction_id.in_(select(Transaction.id).where(Transaction.account_id == account_id)),
        ),
    )
    await db.delete(account)
    await db.flush()
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)

    # Transfers in other accounts record this one as their counterparty, and the restricting foreign
    # key rejects the delete rather than letting those rows lose what they recorded. Transactions
    # inside this account cascade away with it and never reach here
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account is recorded as the counterparty of transfers in other accounts",
        ) from e
