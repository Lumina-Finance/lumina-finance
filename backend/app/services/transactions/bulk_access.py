"""Loading and access checks shared by the bulk transaction services

A bulk edit and a bulk delete both lock the requested rows inside the caller's readable scope and
check write access on every account behind them before writing anything, so a set holding one row
the caller may not change is refused whole
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access
from app.services.transactions.access_helpers import accessible_account_ids_subquery
from app.services.transactions.accounts import validate_transaction_account_is_not_archived

# Postgres raises this for a lock the caller waited out
_LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"

# The most one lock attempt waits before the statement gives up, matching the wait load_locked_run
# in run_locking.py gives an import run. Postgres acquires a multi-row SELECT ... FOR UPDATE's locks
# one row at a time, so a selection whose rows are held by several sessions can wait this long per
# held row rather than once for the whole statement
_BULK_LOCK_WAIT = "10s"


async def load_locked_transactions(
    db: AsyncSession,
    user: User,
    requested_ids: list[uuid.UUID],
) -> list[Transaction]:
    """Load and lock the requested transactions inside the caller's readable scope

    Args:
        db: Active database session
        user: Authenticated user making the change
        requested_ids: Distinct transaction identifiers

    Returns:
        The transactions in id order, locked until the caller's transaction ends

    Raises:
        HTTPException: Another change holds one of the rows, or a transaction was not found
    """
    # Bounded for this statement alone, following load_locked_run in run_locking.py. The setting
    # lasts the whole transaction, so leaving it in place would put the same bound on every lock
    # the commit takes afterwards, including the balance snapshot rebuild
    await db.execute(text(f"SET LOCAL lock_timeout = '{_BULK_LOCK_WAIT}'"))

    # An id belonging to someone else is missing from the result rather than silently changing
    # nothing. Locked in id order so two bulk changes over overlapping rows queue behind each other
    # in the same order rather than deadlocking, and held until this transaction commits so no other
    # writer can change a row between this read and the write. The accessible-accounts filter stays
    # the scalar subquery it is; a join would put the lock on the nullable side of an outer join,
    # which Postgres refuses
    query = (
        select(Transaction)
        .where(
            Transaction.id.in_(requested_ids),
            Transaction.account_id.in_(accessible_account_ids_subquery(user.id)),
        )
        .order_by(Transaction.id)
        .with_for_update()
    )
    try:
        result = await db.execute(query)
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) != _LOCK_NOT_AVAILABLE_SQLSTATE:
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another change reached one of these transactions first",
        ) from exc
    await db.execute(text("SET LOCAL lock_timeout = DEFAULT"))

    transactions = list(result.scalars().all())
    if len(transactions) != len(requested_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{len(requested_ids) - len(transactions)} of {len(requested_ids)} transactions were not found",
        )
    return transactions


async def load_writable_accounts(
    db: AsyncSession,
    user: User,
    account_ids: set[uuid.UUID],
) -> list[Account]:
    """Return the given accounts, refusing any the caller cannot write to

    Row-level security secures ``transactions`` with a check that passes any account permission
    whatever its level, so this application check is the only thing separating read from write

    Args:
        db: Active database session
        user: Authenticated user making the change
        account_ids: Accounts to check

    Returns:
        One account row per identifier

    Raises:
        HTTPException: An account refuses the write or is archived
    """
    accounts = []
    for account_id in sorted(account_ids):
        account = await check_account_access(db, account_id, user.id, PermissionLevel.WRITE)
        validate_transaction_account_is_not_archived(account)
        accounts.append(account)
    return accounts
