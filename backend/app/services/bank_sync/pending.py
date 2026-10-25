"""Replacing an account's pending bank transactions, with what a sync finds pending now or with nothing

A sync replaces a linked account's set only from a fetch that asked for pending records and brought
its bank account back whole, so an account whose part of a fetch failed keeps the items it had
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink
from app.models.bank_pending_transaction import BankPendingTransaction
from app.services.bank_sync.providers.contract import ProviderRecord


async def store_pending_records(
    db: AsyncSession,
    deliveries: Sequence[tuple[BankAccountLink, Sequence[ProviderRecord]]],
    *,
    observed_at: datetime,
) -> None:
    """Replace each link's account's pending items with the pending records its bank account came back with

    An item that posted comes back as a booked record, often under a new ID, and one the bank
    dropped doesn't come back, so both simply leave the set, matched to nothing. A record dated
    before the link's import start is left out, as a booked one is, since the user keeps the ledger
    by hand before that day. The caller locked the links and commits, and stored the booked records
    first, so bank transactions are locked before pending items, the order every writer takes them in

    Args:
        db: The link owner's session
        deliveries: Each link to store for, with the records its bank account came back with whole
            from a fetch that asked for pending records
        observed_at: When the request that brought the records was sent
    """
    for link, records in deliveries:
        # An ID sent twice in one response is one transaction, so the later record of it stands
        pending = {
            record.external_id: record for record in records if record.pending and not record.removed and record.date >= link.import_start
        }
        await replace_pending_transactions(
            db, link.account_id, [_pending_transaction(link, record, observed_at) for record in pending.values()]
        )


async def replace_pending_transactions(
    db: AsyncSession,
    account_id: uuid.UUID,
    pending: Sequence[BankPendingTransaction],
) -> None:
    """Replace an account's pending set wholesale with what the bank reports now

    Items that posted or that the bank dropped disappear without being matched, and an empty set
    clears the account. Other accounts' sets are left alone, so an account whose part of a fetch
    failed keeps the items it had. The caller commits

    Args:
        db: Active database session
        account_id: Account whose set is replaced
        pending: The unsaved items the bank reports now, all for this account
    """
    await db.execute(delete(BankPendingTransaction).where(BankPendingTransaction.account_id == account_id))
    db.add_all(pending)
    await db.flush()


def _pending_transaction(link: BankAccountLink, record: ProviderRecord, observed_at: datetime) -> BankPendingTransaction:
    """Return the unsaved pending item a pending record shows as in the link's account"""
    return BankPendingTransaction(
        owner_id=link.owner_id,
        account_id=link.account_id,
        transaction_date=record.date,
        amount=record.amount,
        # Kept only when the amount can't be stored exactly, for the item to show as the bank sent it
        raw_amount=record.raw_amount if record.amount is None else None,
        description=record.description,
        observed_at=observed_at,
    )
