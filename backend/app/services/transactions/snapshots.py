"""Transaction balance snapshot recalculation services"""
import uuid
from collections.abc import Mapping
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction
from app.services.accounts.snapshots import recompute_account_snapshots

_SNAPSHOT_AFFECTING_UPDATE_FIELDS = frozenset({"account_id", "dt", "amount"})


async def recompute_snapshots_after_transaction_update(
    db: AsyncSession,
    txn: Transaction,
    *,
    previous_account_id: uuid.UUID,
    previous_date: date,
    changed_fields: Mapping[str, object],
) -> None:
    """Recompute account snapshots after updating a transaction

    Only account, date, and amount changes affect balances. Account moves
    recalculate both affected accounts, while same-account changes recalculate
    from the earlier of the previous and current transaction dates

    Args:
        db: Active database session
        txn: Updated transaction row
        previous_account_id: Account that owned the transaction before the update
        previous_date: Transaction date before the update
        changed_fields: Request fields applied to the transaction

    Returns:
        None
    """
    if not _transaction_update_affects_snapshots(changed_fields):
        return

    if txn.account_id != previous_account_id:
        await recompute_account_snapshots(db, {
            previous_account_id: previous_date,
            txn.account_id: txn.dt,
        })
        return

    await recompute_account_snapshots(
        db,
        {txn.account_id: min(previous_date, txn.dt)},
    )


def _transaction_update_affects_snapshots(changed_fields: Mapping[str, object]) -> bool:
    """Return whether transaction updates can change account balances

    Args:
        changed_fields: Request fields applied to the transaction

    Returns:
        True when the update changes account, date, or amount
    """
    return bool(_SNAPSHOT_AFFECTING_UPDATE_FIELDS & changed_fields.keys())
