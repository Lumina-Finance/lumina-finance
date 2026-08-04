"""Account balance snapshot maintenance service

Snapshots include a zero-balance anchor plus one row for each account day with
transaction activity. Transaction and account routes call these helpers after
mutations so the snapshot table stays aligned with account history
"""
import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.account import Account, AccountBalanceSnapshot
from app.models.group import Group
from app.models.transaction import Transaction
from app.models.user import User
from app.utils.dates import ACCOUNT_OWNER_PROFILE, resolve_timezone

PersonalOwner = aliased(User)
GroupOwner = aliased(User)


async def get_current_balances(
    db: AsyncSession, account_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """Return the most recent snapshot balance for each account

    Uses Postgres ``DISTINCT ON`` to pick the row with the highest date per
    account without a self-join

    Args:
        db: Active database session
        account_ids: Account identifiers whose latest balances should be loaded

    Returns:
        Current balances keyed by account identifier
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
    """Attach current balance fields to account rows from latest snapshots

    Args:
        db: Active database session
        accounts: Account rows receiving current balance fields

    Returns:
        None
    """
    if not accounts:
        return
    balances = await get_current_balances(db, [a.id for a in accounts])
    for account in accounts:
        account.current_balance = balances[account.id]


async def recompute_snapshots_from(
    db: AsyncSession, account_id: uuid.UUID, from_dt: date,
) -> None:
    """Rebuild daily balance snapshots from one date forward

    Finds the most recent snapshot strictly before ``from_dt`` to use as an
    anchor balance, deletes all snapshots from that day onwards, then walks
    forward through the account transactions grouped by day

    Args:
        db: Active database session
        account_id: Account whose snapshots need recomputing
        from_dt: First date to rebuild

    Returns:
        None
    """
    # Fetch the most recent snapshot before the rebuild window to anchor the running balance
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

    # Delete existing snapshots in the rebuild window before writing replacements
    await db.execute(
        delete(AccountBalanceSnapshot).where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.dt >= from_dt,
        ),
    )

    # Aggregate transaction amounts by day so each active date becomes one snapshot
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

    # Walk forward through daily totals and write the running balance after each active day
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
    """Restore the account creation-day zero anchor when no snapshots remain

    Args:
        db: Active database session
        account_id: Account whose snapshot history may need a zero anchor

    Returns:
        None

    Raises:
        HTTPException: Owner's stored timezone is not a zone the app recognizes
    """
    # Check whether any snapshot remains before rebuilding the account's zero anchor
    existing = await db.execute(
        select(AccountBalanceSnapshot.account_id)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .limit(1),
    )
    if existing.scalar_one_or_none() is not None:
        return

    # Fetch account creation time and owner timezone so the anchor uses the account owner's local date
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
        dt=row.created_at.astimezone(resolve_timezone(row.tz, stored_on=ACCOUNT_OWNER_PROFILE)).date(),
        balance=0,
    ))
    await db.flush()
