"""Storing what the bank now says about transactions already in the ledger: changed values and removals

The bank's latest values are always stored. A correction is a change to the date, amount or bank
description, compared with the bank values the ledger row was last decided against: those from
before a correction still open, or else the bank's latest. A change to only the merchant name or
category hint is stored and nothing else, since the ledger merchant is always the user's choice and
the category never follows the bank.

Set to review, the changed fields open a correction, and a further change while it is open widens or
narrows the same one, closing it once the bank is back to the values decided or sends the values
the user last declined. Trusted, a changed date or amount the user hasn't edited is applied to the
ledger row, an edited one keeps the user's value, and a changed description is only stored, since
the ledger has no description and a changed description never changes the merchant in this release.
A description the user kept over the bank's stays theirs, as an edited date or amount does.
An amount that can't be stored exactly can't be applied, so it opens a correction even when trusted.
A correction already waiting keeps waiting whatever the preference says, so a change while it is
open joins it. A date or amount the bank changes to the value the ledger already holds needs no
decision, and neither does a description the bank changes back to the one the user kept, so the
field is aligned with the bank again. Aligning a field, here or by accepting a change, ends what the
user declined before, so the bank sending those values again asks again.

A removal is the provider saying the transaction no longer exists. Set to review, it opens a
removal and the ledger row keeps counting until the user decides. It takes the place of a correction
it finds open, since there is no point deciding new values for a transaction that may go, and that
correction's values from before are kept, so keeping the transaction brings the correction back.
Trusted, or removed from the ledger by the user, the ledger row is deleted, and the bank transaction
with it, leaving no marker, so the same transaction sent again later is a new import. Waiting, or
kept by the user, the bank transaction remembers the removal, so the same removal sent again opens
nothing. The provider sending the transaction again means it is back: the removal closes, and what
it sends is compared like any other change, so a correction kept under the removal opens again
"""

import uuid
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account_review_preference import ReviewDecision
from app.models.bank_transaction import BankTransaction, CorrectableBankField, OpenReviewKind
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.bank_sync.review_preferences import read_review_preferences
from app.services.bank_sync.review_state import EDITABLE_COLUMNS, align_with_bank, bank_values, edited_fields
from app.services.transactions.deletion import delete_transaction_row


async def store_accepted_observations(
    db: AsyncSession,
    observations: Sequence[tuple[BankTransaction, Mapping[str, Any]]],
    removals: Sequence[BankTransaction],
    *,
    observed_at: datetime,
) -> bool:
    """Store what the bank now says about transactions already in the ledger, opening or applying the corrections and removals it makes

    The caller has locked the bank transactions and marks the cache. Their ledger rows are locked
    next, together and in id order, and then the balances of each account a trusted correction or
    removal changed, rebuilt in one step from the earliest date it touched

    Args:
        db: The owner's session
        observations: Each accepted bank transaction the bank sent, with the observation columns it
            now sends. They differ from those stored unless the bank had reported it removed
        removals: Each accepted bank transaction the bank newly reports removed
        observed_at: When the request that brought them was sent

    Returns:
        Whether a trusted correction or removal changed the ledger. The caller marks it as a
        change to the owner's data rather than only to what their pages show
    """
    records = [record for record, _ in observations] + list(removals)
    ledger = {
        txn.id: txn
        for txn in await db.scalars(
            select(Transaction)
            .where(Transaction.id.in_([record.transaction_id for record in records]))
            .order_by(Transaction.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    preferences = await read_review_preferences(db, {record.account_id for record in records})

    # A refund link needs its amounts to stay as they are and an edit is checked against them, so a
    # bank's new amount for a linked transaction is left for the user, as an edit of it would be
    linked = set(await db.scalars(_select_linked(ledger)))

    snapshot_starts: dict[uuid.UUID, date] = {}
    for record, observation in observations:
        txn = ledger[record.transaction_id]
        decided = bank_values(record) | (record.previous_values or {})
        for column, value in observation.items():
            setattr(record, column, value)
        record.observed_at = observed_at
        record.removed_at = None

        # A correction is waiting while its values from before are kept, open or under a removal
        trusted = record.previous_values is None and preferences[record.account_id].corrections == ReviewDecision.TRUST
        ledger_before = (txn.dt, txn.amount)
        previous = _settle(record, txn, decided, trusted=trusted, amount_is_linked=txn.id in linked)
        if bank_values(record) == record.declined_observation:
            previous = {}
        record.previous_values = previous or None
        record.open_kind = OpenReviewKind.CORRECTION if previous else None
        if (txn.dt, txn.amount) != ledger_before:
            snapshot_starts[txn.account_id] = min(ledger_before[0], txn.dt, snapshot_starts.get(txn.account_id, txn.dt))

    for record in removals:
        txn = ledger[record.transaction_id]
        if preferences[record.account_id].removals == ReviewDecision.TRUST:
            snapshot_starts[txn.account_id] = min(txn.dt, snapshot_starts.get(txn.account_id, txn.dt))

            # The bank transaction goes with its ledger row, so it is left unwritten
            await delete_transaction_row(db, txn)
        else:
            record.removed_at = observed_at
            record.open_kind = OpenReviewKind.REMOVAL
    await recompute_account_snapshots(db, snapshot_starts)

    # Only a changed date or amount, or a deleted row, reaches the ledger, and each rebuilds balances
    return bool(snapshot_starts)


def _select_linked(ledger: Mapping[uuid.UUID, Transaction]):
    """Select the ids of those ledger rows that are either end of a refund link"""
    ids = list(ledger)
    return (
        select(TransactionLink.refund_transaction_id)
        .where(TransactionLink.refund_transaction_id.in_(ids))
        .union(select(TransactionLink.original_transaction_id).where(TransactionLink.original_transaction_id.in_(ids)))
    )


def _settle(
    record: BankTransaction, txn: Transaction, decided: Mapping[str, Any], *, trusted: bool, amount_is_linked: bool
) -> dict[CorrectableBankField, Any]:
    """Apply to the ledger row what a trusted correction may, and return the changed fields left for the user to decide

    Args:
        record: The bank transaction, holding the bank's new values
        txn: Its ledger row, locked
        decided: The bank values the ledger row was last decided against
        trusted: Whether a change to a field the user hasn't edited applies without review
        amount_is_linked: Whether the ledger row is either end of a refund link, so a new amount waits for the user

    Returns:
        Each field left for the user, with its decided value, as the correction's previous values
    """
    edited = edited_fields(record, txn.dt, txn.amount)
    left: dict[CorrectableBankField, Any] = {}
    for field, value in bank_values(record).items():
        if value == decided[field]:
            continue
        columns = EDITABLE_COLUMNS.get(field)
        if columns is None:
            # The ledger has no description, so the one the user kept stands in for the ledger's
            # value: the bank sending it again aligns it, and a trusted change is only stored
            if value == record.kept_description:
                align_with_bank(record, [field])
            elif not trusted:
                left[field] = decided[field]
            continue
        bank = getattr(record, columns.observed)
        if bank == getattr(txn, columns.ledger):
            align_with_bank(record, [field])
        elif not trusted or (amount_is_linked and columns.ledger == "amount"):
            left[field] = decided[field]
        elif field in edited:
            # The user's value stays, and so does the bank value it was compared with, so it stays edited
            continue
        elif bank is None:
            left[field] = decided[field]
        else:
            setattr(txn, columns.ledger, bank)
            align_with_bank(record, [field])
    return left
