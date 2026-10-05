"""Storing the booked records a sync brings back as review items

A booked record is identified by its Lumina account, provider, bank account and the provider's
transaction ID, so the same ID from another provider or bank account, or sent into another Lumina
account, is another transaction. An unknown identity becomes an item awaiting review,
outside the ledger and every calculation, whatever the account's preference for new transactions
says, since nothing can fill in its merchant and category yet. An item still waiting has its bank
values refreshed in place, a dismissed one stays dismissed whatever the bank now says, and one
already in the ledger has its bank values stored and any correction they make opened or applied
(corrections.py).

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
from datetime import datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.services.bank_sync.corrections import store_accepted_observations
from app.services.bank_sync.providers.contract import ProviderRecord


async def store_booked_records(
    db: AsyncSession,
    deliveries: Sequence[tuple[BankAccountLink, Sequence[ProviderRecord]]],
    *,
    observed_at: datetime,
) -> bool:
    """Store the booked records each link's bank account came back with as review items, or as what the bank now says about ones in the ledger

    The caller locked the links and commits. The stored bank transactions these records name are
    locked in id order, after the links, so a review decision committed while the sync fetched is
    seen here and kept. The ledger rows and balances a correction reaches are locked after them,
    and the owner's cache row is left for last

    Args:
        db: The link owner's session
        deliveries: Each link to store for, with the records its bank account came back with whole
        observed_at: When the request that brought the records was sent

    Returns:
        Whether anything stored changed, so the caller tells the owner's open pages
    """
    wanted = [(link, _booked_records(records)) for link, records in deliveries]
    wanted = [(link, booked) for link, booked in wanted if booked]
    if not wanted:
        return False

    stored = await db.scalars(
        select(BankTransaction)
        .where(
            or_(
                *(
                    and_(
                        BankTransaction.account_id == link.account_id,
                        BankTransaction.provider == link.provider,
                        BankTransaction.external_account_id == link.external_account_id,
                        BankTransaction.external_transaction_id.in_(list(booked)),
                    )
                    for link, booked in wanted
                )
            )
        )
        .order_by(BankTransaction.id)
        .with_for_update()
    )

    known = {(row.account_id, row.provider, row.external_account_id, row.external_transaction_id): row for row in stored}

    changed = False
    accepted: list[tuple[BankTransaction, dict[str, Any]]] = []
    for link, booked in wanted:
        for external_id, record in booked.items():
            observation = _observation(record)
            row = known.get((link.account_id, link.provider, link.external_account_id, external_id))
            if row is None:
                if record.date < link.import_start:
                    continue
                db.add(
                    BankTransaction(
                        owner_id=link.owner_id,
                        account_id=link.account_id,
                        provider=link.provider,
                        external_account_id=link.external_account_id,
                        external_transaction_id=external_id,
                        disposition=BankTransactionDisposition.AWAITING_REVIEW,
                        observed_at=observed_at,
                        **observation,
                    )
                )
                changed = True

            # Writing only what changed leaves a record's version alone when the bank resends it as
            # it was, so a bulk approval previewed before a routine re-read still applies to it
            elif row.disposition == BankTransactionDisposition.DISMISSED or not _differs(row, observation):
                continue
            elif row.disposition == BankTransactionDisposition.ACCEPTED:
                accepted.append((row, observation))
                changed = True
            else:
                for column, value in observation.items():
                    setattr(row, column, value)
                row.observed_at = observed_at
                changed = True
    if accepted:
        await store_accepted_observations(db, accepted, observed_at=observed_at)
    await db.flush()
    return changed


def _differs(row: BankTransaction, observation: dict[str, Any]) -> bool:
    """Return whether an observation holds any value the stored record doesn't"""
    return any(getattr(row, column) != value for column, value in observation.items())


def _booked_records(records: Sequence[ProviderRecord]) -> dict[str, ProviderRecord]:
    """Return a link's booked records by transaction ID

    Pending records are display data kept apart from the review inbox, and a record the provider
    reports removed adds no item. An ID sent twice in one response is one transaction, so the later
    record of it stands
    """
    return {record.external_id: record for record in records if not record.pending and not record.removed}


def _observation(record: ProviderRecord) -> dict[str, Any]:
    """Return the bank transaction columns a record's observation fills"""
    return {
        "observed_date": record.date,
        "observed_amount": record.amount,
        # Kept only when the amount can't be stored exactly, for the item to show as the bank sent it
        "raw_amount": record.raw_amount if record.amount is None else None,
        "description": record.description,
        "merchant_name": record.merchant_name,
        "category_hint": record.category_hint,
        "extras": dict(record.extras),
    }
