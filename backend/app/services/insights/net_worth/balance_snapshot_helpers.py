"""Balance snapshot query helpers for insights net worth"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AccountBalanceSnapshot


@dataclass(frozen=True)
class NetWorthBalanceSnapshot:
    """Store one account balance snapshot for net worth chart calculations

    Attributes:
        account_id: Account ID the snapshot belongs to
        balance: Snapshot balance amount
        snapshot_date: Snapshot date
    """

    account_id: uuid.UUID
    balance: int
    snapshot_date: date


async def get_latest_account_balances_on_or_before(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    target_date: date,
) -> dict[uuid.UUID, int]:
    """Return latest account balances on or before a target date

    Args:
        db: Active database session
        account_ids: Account IDs included in the lookup
        target_date: Latest snapshot date allowed in the lookup

    Returns:
        Balance amount keyed by account ID
    """
    if not account_ids:
        return {}

    # Fetch the latest snapshot for each account on or before the requested date
    result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt <= target_date,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    balances_by_account_id = {row.account_id: int(row.balance) for row in result}
    return balances_by_account_id


async def get_latest_account_balances_before(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    target_date: date,
) -> dict[uuid.UUID, int]:
    """Return latest account balances before a target date

    Args:
        db: Active database session
        account_ids: Account IDs included in the lookup
        target_date: Snapshot date that must not be reached

    Returns:
        Balance amount keyed by account ID
    """
    if not account_ids:
        return {}

    # Fetch the latest snapshot for each account before the first visible chart bucket
    result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt < target_date,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    balances_by_account_id = {row.account_id: int(row.balance) for row in result}
    return balances_by_account_id


async def get_account_balance_snapshots_in_range(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> list[NetWorthBalanceSnapshot]:
    """Return account balance snapshots inside an inclusive date range

    Args:
        db: Active database session
        account_ids: Account IDs included in the lookup
        from_date: Inclusive snapshot range start date
        to_date: Inclusive snapshot range end date

    Returns:
        Account balance snapshots ordered by date and account ID
    """
    if not account_ids:
        return []

    # Load all visible in-range balance snapshots so chart buckets can carry balances forward
    result = await db.execute(
        select(
            AccountBalanceSnapshot.account_id,
            AccountBalanceSnapshot.balance,
            AccountBalanceSnapshot.dt,
        )
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt >= from_date,
            AccountBalanceSnapshot.dt <= to_date,
        )
        .order_by(AccountBalanceSnapshot.dt, AccountBalanceSnapshot.account_id),
    )
    snapshots = [
        NetWorthBalanceSnapshot(
            account_id=row.account_id,
            balance=int(row.balance),
            snapshot_date=row.dt,
        )
        for row in result
    ]
    return snapshots
