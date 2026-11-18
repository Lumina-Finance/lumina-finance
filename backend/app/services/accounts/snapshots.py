"""Account balance snapshot maintenance service

Snapshots include a zero-balance anchor plus one row for each account day with
transaction activity. Transaction and account routes call these helpers after
mutations so the snapshot table stays aligned with account history. Rebuilds
for the same account serialize until their caller commits or rolls back
"""

import hashlib
import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import BigInteger, and_, cast, delete, func, inspect, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.account import Account, AccountBalanceSnapshot
from app.models.group import Group
from app.models.transaction import Transaction
from app.models.user import User
from app.utils.dates import ACCOUNT_OWNER_PROFILE, resolve_timezone
from app.utils.money import MAX_MINOR_UNITS, MIN_MINOR_UNITS

PersonalOwner = aliased(User)
GroupOwner = aliased(User)

# The namespace separates this protocol's lock inputs from other advisory lock protocols
_SNAPSHOT_LOCK_NAMESPACE = b"lumina:account-snapshots:"


async def get_current_balances(
    db: AsyncSession,
    account_ids: Sequence[uuid.UUID],
    as_of_date: date,
) -> dict[uuid.UUID, int]:
    """Return the latest eligible snapshot balance for each account

    Uses Postgres ``DISTINCT ON`` to pick the row with the highest date per
    account without a self-join

    Args:
        db: Active database session
        account_ids: Account identifiers whose latest balances should be loaded
        as_of_date: Latest eligible transaction date in the viewer's calendar

    Returns:
        Current balances keyed by account identifier
    """
    if not account_ids:
        return {}

    result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt <= as_of_date,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    return {row.account_id: row.balance for row in result}


async def attach_current_balances(db: AsyncSession, accounts: Sequence[Account], as_of_date: date) -> None:
    """Attach current balance fields to account rows from latest snapshots

    Args:
        db: Active database session
        accounts: Account rows receiving current balance fields
        as_of_date: Latest eligible transaction date in the viewer's calendar

    Returns:
        None
    """
    if not accounts:
        return
    balances = await get_current_balances(db, [a.id for a in accounts], as_of_date)
    for account in accounts:
        account.current_balance = balances.get(account.id, 0)


async def recompute_account_snapshots(
    db: AsyncSession,
    snapshot_starts: Mapping[uuid.UUID, date],
) -> None:
    """Rebuild daily balance snapshots for every affected account

    Flushes the caller's pending changes, then acquires transaction-scoped
    advisory locks in stable order before reading any account's anchor. Locks
    remain held until the caller commits or rolls back

    Args:
        db: Active database session
        snapshot_starts: Earliest rebuild date keyed by affected account ID

    Returns:
        None

    Raises:
        HTTPException: An account's running balance would fall outside the range the column holds
    """
    if not snapshot_starts:
        return

    await db.flush()
    lock_keys = sorted({_snapshot_lock_key(account_id) for account_id in snapshot_starts})

    # Serialize every affected account before any anchor read so a rebuild sees earlier commits
    for lock_key in lock_keys:
        await db.execute(select(func.pg_advisory_xact_lock(lock_key)))

    for account_id, from_dt in snapshot_starts.items():
        await _recompute_account_snapshots_from(db, account_id, from_dt)


def sort_by_snapshot_lock(account_ids: Iterable[uuid.UUID]) -> list[uuid.UUID]:
    """Return the accounts in the order every rebuild takes their locks

    A save that rebuilds several accounts one at a time goes through them in this order, so it never
    holds one account's lock while waiting for another that a rebuild of several at once already holds
    """
    return sorted(set(account_ids), key=_snapshot_lock_key)


def _snapshot_lock_key(account_id: uuid.UUID) -> int:
    """Return the stable signed 64-bit advisory lock key for an account."""
    digest = hashlib.blake2b(
        _SNAPSHOT_LOCK_NAMESPACE + account_id.bytes,
        digest_size=8,
    ).digest()
    return int.from_bytes(digest, byteorder="big", signed=True)


def refuse_unstorable_balance(account_name: str, balance: int) -> None:
    """Refuse a balance, or a single amount, outside the range the column holds

    Args:
        account_name: Account the balance belongs to, named in the refusal
        balance: Balance or amount in minor units

    Raises:
        HTTPException: The value is outside the signed 64-bit range
    """
    if MIN_MINOR_UNITS <= balance <= MAX_MINOR_UNITS:
        return

    # A hugely negative balance is not a "larger" one, so each direction gets its own wording
    limit_wording = (
        "a larger balance than an account can hold" if balance > MAX_MINOR_UNITS else "a balance further below zero than an account can hold"
    )
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=f"{account_name} would end up with {limit_wording}",
    )


async def _recompute_account_snapshots_from(
    db: AsyncSession,
    account_id: uuid.UUID,
    from_dt: date,
) -> None:
    """Rebuild one account's daily balance snapshots from one date forward."""
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

    # Each active day's balance after the day, summed as numeric so a balance past the column's
    # range can be found and refused rather than failing the write as a server error
    daily_balances = (
        select(
            Transaction.dt.label("dt"),
            (literal(anchor or 0, BigInteger) + func.sum(func.sum(Transaction.amount)).over(order_by=Transaction.dt)).label("balance"),
        )
        .where(Transaction.account_id == account_id, Transaction.dt >= from_dt)
        .group_by(Transaction.dt)
        .cte("daily_balances")
    )

    unstorable_balance = await db.scalar(
        select(daily_balances.c.balance)
        .where(~daily_balances.c.balance.between(MIN_MINOR_UNITS, MAX_MINOR_UNITS))
        .order_by(daily_balances.c.dt)
        .limit(1),
    )
    if unstorable_balance is not None:
        account_name = await db.scalar(select(Account.name).where(Account.id == account_id))
        refuse_unstorable_balance(account_name, int(unstorable_balance))

    # Days left with no transactions lose their snapshot, as a rewrite of the window would drop them
    has_transactions = (
        select(Transaction.id)
        .where(Transaction.account_id == AccountBalanceSnapshot.account_id, Transaction.dt == AccountBalanceSnapshot.dt)
        .exists()
    )
    await db.execute(
        delete(AccountBalanceSnapshot).where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.dt >= from_dt,
            ~has_transactions,
        ),
    )

    # Only days whose stored balance differs are written. They're left out of the source rows
    # rather than skipped by a condition on the update, since PostgreSQL locks a conflicting row
    # even when that condition turns the update down
    snapshots = AccountBalanceSnapshot.__table__
    stored = snapshots.alias("stored")
    changed_days = (
        select(
            literal(account_id, snapshots.c.account_id.type),
            daily_balances.c.dt,
            cast(daily_balances.c.balance, BigInteger),
        )
        .select_from(
            daily_balances.outerjoin(stored, and_(stored.c.account_id == account_id, stored.c.dt == daily_balances.c.dt)),
        )
        .where(stored.c.balance.is_distinct_from(daily_balances.c.balance))
    )
    upsert = insert(snapshots).from_select(["account_id", "dt", "balance"], changed_days)
    await db.execute(
        upsert.on_conflict_do_update(
            index_elements=[snapshots.c.account_id, snapshots.c.dt],
            set_={"balance": upsert.excluded.balance},
        ),
    )

    # The write bypasses the session, so snapshots the session already holds reload their balance on next use.
    # Each is matched by its identity key, since reading an attribute of one expired earlier would load it
    for held in list(db.identity_map.values()):
        if isinstance(held, AccountBalanceSnapshot):
            held_account_id, held_dt = inspect(held).identity
            if held_account_id == account_id and held_dt >= from_dt:
                db.expire(held)

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
        select(AccountBalanceSnapshot.account_id).where(AccountBalanceSnapshot.account_id == account_id).limit(1),
    )
    if existing.scalar_one_or_none() is not None:
        return

    # Fetch account creation time and owner timezone so the anchor uses the account owner's local date
    row = (
        await db.execute(
            select(Account.created_at, func.coalesce(PersonalOwner.tz, GroupOwner.tz).label("tz"))
            .outerjoin(PersonalOwner, Account.owner_id == PersonalOwner.id)
            .outerjoin(Group, Account.group_id == Group.id)
            .outerjoin(GroupOwner, Group.owner_id == GroupOwner.id)
            .where(Account.id == account_id),
        )
    ).one_or_none()
    if row is None or row.created_at is None or row.tz is None:
        return

    db.add(
        AccountBalanceSnapshot(
            account_id=account_id,
            dt=row.created_at.astimezone(resolve_timezone(row.tz, stored_on=ACCOUNT_OWNER_PROFILE)).date(),
            balance=0,
        )
    )
    await db.flush()
