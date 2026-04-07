"""Account balance snapshot maintenance.

Snapshots are derived from transactions: one row per `(account, date)` where a
transaction occurred. The helpers here are called from the transaction routes
after any mutation to keep the snapshot table consistent.
"""
import uuid
from datetime import UTC, date, datetime, time

from sqlalchemy import Date, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AccountBalanceSnapshot
from app.models.transaction import Transaction


async def recompute_snapshots_from(
    db: AsyncSession, account_id: uuid.UUID, from_date: date,
) -> None:
    """Delete and rebuild daily balance snapshots from from_date forward.

    Finds the most recent snapshot strictly before from_date to use as an
    anchor balance, deletes all snapshots from from_date onwards, then walks
    forward through the transactions on this account grouped by day, writing
    one snapshot per day with activity.

    Call this after any transaction mutation affecting the account:
    - create: pass the new transaction's date
    - update: pass min(old_date, new_date); call for both accounts if moved
    - delete: pass the deleted transaction's date

    Args:
        db: Async database session.
        account_id: UUID of the account whose snapshots need recomputing.
        from_date: Rebuild snapshots on and after this date.
    """
    # Anchor balance: most recent snapshot strictly before from_date, or 0
    anchor_result = await db.execute(
        select(AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.date < from_date,
        )
        .order_by(AccountBalanceSnapshot.date.desc())
        .limit(1),
    )
    running_balance = anchor_result.scalar_one_or_none() or 0

    # Wipe existing snapshots in the recomputation range
    await db.execute(
        delete(AccountBalanceSnapshot).where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.date >= from_date,
        ),
    )

    # Aggregate transaction amounts by day (UTC) from from_date forward
    from_dt = datetime.combine(from_date, time.min, tzinfo=UTC)
    day_col = cast(func.timezone("UTC", Transaction.ts), Date).label("day")
    delta_col = func.sum(Transaction.amount).label("delta")
    deltas_result = await db.execute(
        select(day_col, delta_col)
        .where(
            Transaction.account_id == account_id,
            Transaction.ts >= from_dt,
        )
        .group_by(day_col)
        .order_by(day_col),
    )

    # Walk forward, writing one snapshot per day with activity
    for row in deltas_result:
        running_balance += row.delta
        db.add(AccountBalanceSnapshot(
            account_id=account_id,
            date=row.day,
            balance=running_balance,
        ))

    await db.flush()
