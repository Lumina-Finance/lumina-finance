"""Account balance snapshot maintenance.

Snapshots include a zero-balance anchor plus one row per `(account, day)` where
a transaction occurred. The helpers here are called from the transaction routes
after any mutation to keep the snapshot table consistent.
"""
import uuid
from collections.abc import Sequence
from datetime import date
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.account import Account, AccountBalanceSnapshot
from app.models.group import Group
from app.models.transaction import Transaction
from app.models.user import User

PersonalOwner = aliased(User)
GroupOwner = aliased(User)


async def get_current_balances(
    db: AsyncSession, account_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """Return the most recent snapshot balance for each account in one query.

    Uses Postgres ``DISTINCT ON`` to pick the row with the highest ``dt`` per account
    without a self-join. Every account should have at least one snapshot: the
    zero anchor inserted at account creation and restored when history is emptied.
    """
    if not account_ids:
        return {}

    result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(AccountBalanceSnapshot.account_id.in_(account_ids))
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    return {row.account_id: row.balance for row in result}


async def attach_current_balances(db: AsyncSession, accounts: Sequence[Account]) -> None:
    """Set ``current_balance`` on each account row in-place from the latest snapshot.

    Single query regardless of how many accounts. Used by list_accounts (bulk) and the
    detail-shape endpoints (single account); both share the same source of truth.
    """
    if not accounts:
        return
    balances = await get_current_balances(db, [a.id for a in accounts])
    for account in accounts:
        account.current_balance = balances[account.id]


async def recompute_snapshots_from(
    db: AsyncSession, account_id: uuid.UUID, from_dt: date,
) -> None:
    """Delete and rebuild daily balance snapshots from ``from_dt`` forward.

    Finds the most recent snapshot strictly before ``from_dt`` to use as an
    anchor balance, deletes all snapshots from that day onwards, then walks
    forward through the transactions on this account grouped by day, writing
    one snapshot per day with activity.

    Call this after any transaction mutation affecting the account:
    - create: pass the new transaction's dt
    - update: pass min(old_dt, new_dt); call for both accounts if moved
    - delete: pass the deleted transaction's dt

    Args:
        db: Async database session.
        account_id: UUID of the account whose snapshots need recomputing.
        from_dt: Rebuild snapshots for this date and forward.
    """
    # Anchor balance: most recent snapshot strictly before from_dt, or 0
    anchor_result = await db.execute(
        select(AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.dt < from_dt,
        )
        .order_by(AccountBalanceSnapshot.dt.desc())
        .limit(1),
    )
    anchor = anchor_result.scalar_one_or_none()
    running_balance = anchor if anchor is not None else 0

    # Wipe existing snapshots in the recomputation range
    await db.execute(
        delete(AccountBalanceSnapshot).where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.dt >= from_dt,
        ),
    )

    # Aggregate transaction amounts by day from from_dt forward
    delta_col = func.sum(Transaction.amount).label("delta")
    deltas_result = await db.execute(
        select(Transaction.dt, delta_col)
        .where(
            Transaction.account_id == account_id,
            Transaction.dt >= from_dt,
        )
        .group_by(Transaction.dt)
        .order_by(Transaction.dt),
    )

    # Walk forward, writing one snapshot per day with activity
    for row in deltas_result:
        running_balance += row.delta
        db.add(AccountBalanceSnapshot(
            account_id=account_id,
            dt=row.dt,
            balance=running_balance,
        ))

    await db.flush()
    await restore_zero_anchor_if_empty(db, account_id)


async def restore_zero_anchor_if_empty(db: AsyncSession, account_id: uuid.UUID) -> None:
    """Restore the account creation-day zero anchor when no snapshots remain."""
    existing = await db.execute(
        select(AccountBalanceSnapshot.account_id)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .limit(1),
    )
    if existing.scalar_one_or_none() is not None:
        return

    row = (await db.execute(
        select(Account.created_at, func.coalesce(PersonalOwner.tz, GroupOwner.tz).label("tz"))
        .outerjoin(PersonalOwner, Account.owner_id == PersonalOwner.id)
        .outerjoin(Group, Account.group_id == Group.id)
        .outerjoin(GroupOwner, Group.owner_id == GroupOwner.id)
        .where(Account.id == account_id),
    )).one_or_none()
    if row is None or row.created_at is None or row.tz is None:
        return

    db.add(AccountBalanceSnapshot(
        account_id=account_id,
        dt=row.created_at.astimezone(ZoneInfo(row.tz)).date(),
        balance=0,
    ))
    await db.flush()
