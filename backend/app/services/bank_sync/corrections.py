"""Storing what the bank now says about transactions already in the ledger: changed values and removals

The bank's latest values are always stored, and nothing here changes the ledger. A correction is a
change to the date, amount or bank description, compared with the bank values the ledger row was
last decided against: those from before a correction still open, or else the bank's latest. A change
to only the merchant name or category hint is stored and nothing else, since the ledger merchant is
always the user's choice and the category never follows the bank.

The changed fields open a correction, and a further change while it is open widens or narrows the
same one, closing it once the bank is back to the values decided or sends the values the user last
declined. A date or amount the bank changes to the value the ledger already holds needs no decision,
and neither does a description the bank changes back to the one the user kept, so the field is
aligned with the bank again. Aligning a field, here or by accepting a change, ends what the user
declined before, so the bank sending those values again asks again.

A removal is the provider saying the transaction no longer exists. It opens a removal and the ledger
row keeps counting until the user decides. It takes the place of a correction it finds open, since
there is no point deciding new values for a transaction that may go, and that correction's values
from before are kept, so keeping the transaction brings the correction back. Removed from the ledger
by the user, the ledger row is deleted, and the bank transaction with it, leaving no marker, so the
same transaction sent again later is a new import. Waiting, or kept by the user, the bank transaction
remembers the removal, so the same removal sent again opens nothing. The provider sending the
transaction again means it is back: the removal closes, and what it sends is compared like any other
change, so a correction kept under the removal opens again
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransaction, CorrectableBankField, OpenReviewKind
from app.models.transaction import Transaction
from app.services.bank_sync.review_state import EDITABLE_COLUMNS, align_with_bank, bank_values


async def store_accepted_observations(
    db: AsyncSession,
    observations: Sequence[tuple[BankTransaction, Mapping[str, Any]]],
    removals: Sequence[BankTransaction],
    *,
    observed_at: datetime,
) -> None:
    """Store what the bank now says about transactions already in the ledger, opening the corrections and removals it makes

    The caller has locked the bank transactions and marks the cache. Their ledger rows are locked
    next, together and in id order, so an edit saving at the same time can't change the date or
    amount a new bank value is compared with

    Args:
        db: The owner's session
        observations: Each accepted bank transaction the bank sent, with the observation columns it
            now sends. They differ from those stored unless the bank had reported it removed
        removals: Each accepted bank transaction the bank newly reports removed
        observed_at: When the request that brought them was sent
    """
    records = [record for record, _ in observations]
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

    for record, observation in observations:
        txn = ledger[record.transaction_id]
        decided = bank_values(record) | (record.previous_values or {})
        for column, value in observation.items():
            setattr(record, column, value)
        record.observed_at = observed_at
        record.removed_at = None
        previous = _changed_fields(record, txn, decided)
        if bank_values(record) == record.declined_observation:
            previous = {}
        record.previous_values = previous or None
        record.open_kind = OpenReviewKind.CORRECTION if previous else None

    for record in removals:
        record.removed_at = observed_at
        record.open_kind = OpenReviewKind.REMOVAL


def _changed_fields(record: BankTransaction, txn: Transaction, decided: Mapping[str, Any]) -> dict[CorrectableBankField, Any]:
    """Return the changed fields left for the user to decide, aligning those the ledger already agrees with

    Args:
        record: The bank transaction, holding the bank's new values
        txn: Its ledger row, locked
        decided: The bank values the ledger row was last decided against

    Returns:
        Each field left for the user, with its decided value, as the correction's previous values
    """
    left: dict[CorrectableBankField, Any] = {}
    for field, value in bank_values(record).items():
        if value == decided[field]:
            continue
        columns = EDITABLE_COLUMNS.get(field)

        # The ledger has no description, so the one the user kept stands in for the ledger's value
        agrees = value == record.kept_description if columns is None else getattr(record, columns.observed) == getattr(txn, columns.ledger)
        if agrees:
            align_with_bank(record, [field])
        else:
            left[field] = decided[field]
    return left
