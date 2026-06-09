"""Net worth balance snapshot helpers for dashboard widgets"""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AccountBalanceSnapshot


async def get_net_worth_starting_balances(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_start: date,
) -> dict[uuid.UUID, int]:
    """Return starting balances for a dashboard net worth window

    Args:
        db: Active database session
        account_ids: Account IDs included in the dashboard scope
        window_start: First date in the dashboard history window

    Returns:
        Balance amount keyed by account ID with zeroes for accounts without prior snapshots
    """
    if not account_ids:
        starting_balances: dict[uuid.UUID, int] = {}
        return starting_balances

    # Fetch each account's latest pre-window balance so the first slot can carry it forward
    result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt < window_start,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    starting_balances = {row.account_id: int(row.balance) for row in result}
    for account_id in account_ids:
        starting_balances.setdefault(account_id, 0)
    return starting_balances


async def get_net_worth_balance_updates_by_day(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_start: date,
) -> dict[date, dict[uuid.UUID, int]]:
    """Return dashboard net worth balance updates grouped by snapshot date

    Args:
        db: Active database session
        account_ids: Account IDs included in the dashboard scope
        window_start: First date in the dashboard history window

    Returns:
        Balance updates keyed by snapshot date and account ID
    """
    if not account_ids:
        balance_updates_by_day: dict[date, dict[uuid.UUID, int]] = {}
        return balance_updates_by_day

    # Load every in-window snapshot update that can change the daily net worth series
    result = await db.execute(
        select(
            AccountBalanceSnapshot.account_id,
            AccountBalanceSnapshot.balance,
            AccountBalanceSnapshot.dt,
        )
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt >= window_start,
        )
        .order_by(AccountBalanceSnapshot.dt),
    )
    balance_updates_by_day: dict[date, dict[uuid.UUID, int]] = {}
    for row in result:
        balance_updates_by_day.setdefault(row.dt, {})[row.account_id] = int(row.balance)
    return balance_updates_by_day
