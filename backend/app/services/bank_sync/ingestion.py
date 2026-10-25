"""Storing the booked records a sync brings back as review items

A booked record is identified by its Lumina account, provider, bank account and the provider's
transaction ID, so the same ID from another provider or bank account, or sent into another Lumina
account, is another transaction. An unknown identity becomes an item awaiting review,
outside the ledger and every calculation, whatever the account's preference for new transactions
says, since nothing can fill in its merchant and category yet. An item still waiting has its bank
values refreshed in place, a dismissed one stays dismissed whatever the bank now says, and one
already in the ledger has its bank values stored and any correction they make opened or applied
(corrections.py).

A record the provider explicitly reports removed takes out an item still waiting, with no review
task and nothing kept, so the same transaction sent later is a new import, and opens or applies a
removal on one in the ledger (corrections.py). It changes nothing for a transaction never brought in
or dismissed. A transaction merely missing from a response is never treated as removed, since a
provider that reports no removals, such as SimpleFIN, says nothing about what it leaves out.

A new record dated before the link's import start is left out, but never one dated before the
window that brought it back, since a provider can date a record the day before the window it came
back in, and the window before it, which ended at that midnight, didn't include it. The import start
decides only which records come in, so one already stored that the bank now dates before it is
stored like any other change: an item waiting keeps waiting with the new date, and one in the
ledger has its correction opened or applied.

An amount that can't be stored exactly in the account's currency is kept as the bank sent it, with
no amount, so its item waits for the user to enter one rather than being rounded or dropped
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.services.bank_sync.corrections import store_accepted_observations
from app.services.bank_sync.providers.contract import ProviderRecord
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id


@dataclass(frozen=True)
class StoredRecords:
    """What storing a sync's booked records changed"""

    # Anything stored, so the caller tells the owner's open pages
    changed: bool = False

    # A trusted correction or removal reached the ledger, which the caller marks as a change to the
    # owner's data rather than only to what their pages show
    ledger_changed: bool = False


async def store_booked_records(
    db: AsyncSession,
    deliveries: Sequence[tuple[BankAccountLink, Sequence[ProviderRecord]]],
    *,
    observed_at: datetime,
) -> StoredRecords:
    """Store the booked records each link's bank account came back with as review items, or as what the bank now says about ones in the ledger

    The caller locked the links and commits. The stored bank transactions these records name are
    locked in id order, after the links, so a review decision committed while the sync fetched is
    seen here and kept. The ledger rows and balances a correction or removal reaches are locked
    after them, and the owner's cache row is left for last

    Args:
        db: The link owner's session
        deliveries: Each link to store for, with the records its bank account came back with whole
        observed_at: When the request that brought the records was sent

    Returns:
        Whether anything stored changed, and whether that reached the ledger
    """
    wanted = [(link, _booked_records(link, records)) for link, records in deliveries]
    wanted = [(link, booked) for link, booked in wanted if booked]
    if not wanted:
        return StoredRecords()

    stored = await db.scalars(
        select(BankTransaction)
        .where(
            or_(
                *(
                    and_(
                        BankTransaction.account_id == link.account_id,
                        BankTransaction.provider == link.provider,
                        BankTransaction.external_account_id == link.external_account_id,
                        BankTransaction.external_transaction_hash.in_(list(booked)),
                    )
                    for link, booked in wanted
                )
            )
        )
        .order_by(BankTransaction.id)
        .with_for_update()
    )

    known = {(row.account_id, row.provider, row.external_account_id, row.external_transaction_hash): row for row in stored}

    changed = False
    accepted: list[tuple[BankTransaction, dict[str, Any]]] = []
    removed: list[BankTransaction] = []
    for link, booked in wanted:
        for transaction_hash, record in booked.items():
            row = known.get((link.account_id, link.provider, link.external_account_id, transaction_hash))
            if record.removed:
                # A transaction never brought in has nothing to remove, a dismissal stands whatever the
                # bank says, and a removal already recorded is the same one delivered again
                if row is None or row.disposition == BankTransactionDisposition.DISMISSED or row.removed_at is not None:
                    continue
                if row.disposition == BankTransactionDisposition.ACCEPTED:
                    removed.append(row)
                else:
                    await db.delete(row)
                changed = True
                continue

            observation = _observation(record)
            if row is None:
                if record.date < link.import_start:
                    continue
                db.add(
                    BankTransaction(
                        owner_id=link.owner_id,
                        account_id=link.account_id,
                        provider=link.provider,
                        external_account_id=link.external_account_id,
                        external_transaction_hash=transaction_hash,
                        disposition=BankTransactionDisposition.AWAITING_REVIEW,
                        observed_at=observed_at,
                        **observation,
                    )
                )
                changed = True

            # Writing only what changed leaves a record's version alone when the bank resends it as
            # it was, so a bulk approval previewed before a routine re-read still applies to it. One
            # the bank had reported removed is back, however unchanged
            elif row.disposition == BankTransactionDisposition.DISMISSED or (row.removed_at is None and not _differs(row, observation)):
                continue
            elif row.disposition == BankTransactionDisposition.ACCEPTED:
                accepted.append((row, observation))
                changed = True
            else:
                for column, value in observation.items():
                    setattr(row, column, value)
                row.observed_at = observed_at
                changed = True
    ledger_changed = False
    if accepted or removed:
        ledger_changed = await store_accepted_observations(db, accepted, removed, observed_at=observed_at)
    await db.flush()
    return StoredRecords(changed=changed, ledger_changed=ledger_changed)


def _differs(row: BankTransaction, observation: dict[str, Any]) -> bool:
    """Return whether an observation holds any value the stored record doesn't"""
    return any(getattr(row, column) != value for column, value in observation.items())


def _booked_records(link: BankAccountLink, records: Sequence[ProviderRecord]) -> dict[str, ProviderRecord]:
    """Return a link's records of booked transactions by the keyed hash of their transaction ID, those the provider reports removed included

    Pending records are display data kept apart from the review inbox. An ID sent twice in one
    response is one transaction, so the later record of it stands, whether it lists the transaction
    or reports it removed
    """
    return {
        hash_bank_transaction_id(link.provider, link.external_account_id, record.external_id): record
        for record in records
        if not record.pending
    }


def _observation(record: ProviderRecord) -> dict[str, Any]:
    """Return the bank transaction columns a record's observation fills"""
    return {
        "observed_date": record.date,
        "observed_amount": record.amount,
        # Kept only when the amount can't be stored exactly, for the item to show as the bank sent it
        "raw_amount": record.raw_amount if record.amount is None else None,
        "description": record.description,
    }
