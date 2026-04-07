"""Account balance snapshot maintenance.

Snapshots are derived from transactions: one row per `(account, day)` where a
transaction occurred. `AccountBalanceSnapshot.ts` is always stored as midnight
UTC of the snapshot's day. The helpers here are called from the transaction
routes after any mutation to keep the snapshot table consistent.
"""
import uuid
from datetime import UTC, date, datetime, time

from sqlalchemy import Date, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AccountBalanceSnapshot
from app.models.transaction import Transaction


def _utc_midnight(ts: datetime) -> datetime:
    """Return the midnight-UTC datetime for the UTC day containing ts."""
    utc_day: date = ts.astimezone(UTC).date() if ts.tzinfo else ts.date()
    return datetime.combine(utc_day, time.min, tzinfo=UTC)


async def recompute_snapshots_from(
    db: AsyncSession, account_id: uuid.UUID, from_ts: datetime,
) -> None:
    """Delete and rebuild daily balance snapshots from the UTC day of from_ts forward.

    Finds the most recent snapshot strictly before that day to use as an anchor
    balance, deletes all snapshots from that day onwards, then walks forward
    through the transactions on this account grouped by UTC day, writing one
    snapshot per day with activity (stored at midnight UTC of that day).

    Call this after any transaction mutation affecting the account:
    - create: pass the new transaction's ts
    - update: pass min(old_ts, new_ts); call for both accounts if moved
    - delete: pass the deleted transaction's ts

    Args:
        db: Async database session.
        account_id: UUID of the account whose snapshots need recomputing.
        from_ts: Rebuild snapshots for the UTC day of this datetime and forward.
    """
    window_start = _utc_midnight(from_ts)

    # Anchor balance: most recent snapshot strictly before window_start, or 0
    anchor_result = await db.execute(
        select(AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.ts < window_start,
        )
        .order_by(AccountBalanceSnapshot.ts.desc())
        .limit(1),
    )
    anchor = anchor_result.scalar_one_or_none()
    running_balance = anchor if anchor is not None else 0

    # Wipe existing snapshots in the recomputation range
    await db.execute(
        delete(AccountBalanceSnapshot).where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.ts >= window_start,
        ),
    )

    # Aggregate transaction amounts by UTC day from window_start forward
    day_col = cast(func.timezone("UTC", Transaction.ts), Date).label("day")
    delta_col = func.sum(Transaction.amount).label("delta")
    deltas_result = await db.execute(
        select(day_col, delta_col)
        .where(
            Transaction.account_id == account_id,
            Transaction.ts >= window_start,
        )
        .group_by(day_col)
        .order_by(day_col),
    )

    # Walk forward, writing one snapshot per day with activity
    for row in deltas_result:
        running_balance += row.delta
        day_midnight = datetime.combine(row.day, time.min, tzinfo=UTC)
        db.add(AccountBalanceSnapshot(
            account_id=account_id,
            ts=day_midnight,
            balance=running_balance,
        ))

    await db.flush()
