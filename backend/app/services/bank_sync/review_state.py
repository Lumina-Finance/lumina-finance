"""The rules that read a bank transaction's review state

The bank transactions that wait for review, the ledger fields that count as edited, the bank values a
correction compares and stores, the description the ledger row was decided with, and the ledger row
approving a waiting item leaves are worked out here from the stored record, so the transaction
responses, ingestion, the review actions and the balances that look ahead to them all apply the same
rule
"""

from collections.abc import Collection
from datetime import date
from typing import Any, NamedTuple

from app.models.bank_transaction import (
    BankTransaction,
    BankTransactionDisposition,
    CorrectableBankField,
    EditableBankField,
    OpenReviewKind,
)

# A new bank transaction awaiting its first review
AWAITING_REVIEW = BankTransaction.disposition == BankTransactionDisposition.AWAITING_REVIEW

# A bank transaction is an item waiting for review while it awaits its first review or has a
# correction or removal open
IS_REVIEW_ITEM = AWAITING_REVIEW | BankTransaction.open_kind.is_not(None)


class EditableColumns(NamedTuple):
    """Where an editable field's value sits on the ledger row and on its bank transaction"""

    ledger: str
    aligned: str
    observed: str


EDITABLE_COLUMNS: dict[EditableBankField, EditableColumns] = {
    "date": EditableColumns("dt", "aligned_date", "observed_date"),
    "amount": EditableColumns("amount", "aligned_amount", "observed_amount"),
}


class LedgerEntry(NamedTuple):
    """A ledger row's date and its amount in signed minor units (None for a bank amount the account's currency can't hold)"""

    dt: date
    amount: int | None


def approved_entry(record: BankTransaction, ledger: LedgerEntry | None) -> LedgerEntry | None:
    """Return the ledger row a waiting item leaves once approved as the bank sent it

    Adding a new item writes the bank's date and amount, accepting a correction writes the bank's
    value for each field it changes, and removing deletes the row

    Args:
        record: A bank transaction waiting for review
        ledger: Its ledger row. A new item doesn't have one yet

    Returns:
        The row as approving leaves it, or None for a removal
    """
    if record.disposition == BankTransactionDisposition.AWAITING_REVIEW:
        return LedgerEntry(record.observed_date, record.observed_amount)
    if record.open_kind == OpenReviewKind.REMOVAL:
        return None
    changed = record.previous_values
    return LedgerEntry(
        dt=record.observed_date if "date" in changed else ledger.dt,
        amount=record.observed_amount if "amount" in changed else ledger.amount,
    )


def edited_fields(record: BankTransaction, ledger_date: date, ledger_amount: int) -> list[EditableBankField]:
    """Return the fields the ledger row holds differently from the bank values it was last aligned with

    Args:
        record: The accepted bank transaction the ledger row came from
        ledger_date: The ledger row's date
        ledger_amount: The ledger row's amount in minor units

    Returns:
        The edited fields, in display order
    """
    edited: list[EditableBankField] = []
    if ledger_date != record.aligned_date:
        edited.append("date")

    # An amount the bank couldn't give exactly was entered by the user, so it is theirs
    if record.aligned_amount is None or ledger_amount != record.aligned_amount:
        edited.append("amount")
    return edited


def bank_values(record: BankTransaction) -> dict[CorrectableBankField, Any]:
    """Return the bank's latest values of the fields a correction can change, as a correction stores them

    The date is ISO text, and an amount the bank sent that couldn't be stored exactly is the text it
    sent, so two such amounts still compare
    """
    return {
        "date": record.observed_date.isoformat(),
        "amount": record.raw_amount if record.observed_amount is None else record.observed_amount,
        "description": record.description,
    }


def approved_description(record: BankTransaction) -> str:
    """Return the bank description the ledger row was last decided with. The ledger has no column for it

    That is the one the user kept over a later one, or else the bank's from before a correction
    waiting on it, or else the bank's latest
    """
    if record.kept_description is not None:
        return record.kept_description
    return (record.previous_values or {}).get("description", record.description)


def align_with_bank(record: BankTransaction, fields: Collection[str]) -> None:
    """Align the named fields with the bank's latest values, so a date or amount counts as edited only while the ledger differs from them

    An aligned description ends the one the user kept, so the ledger follows the bank's again.
    Aligning decides the ledger row against the bank's latest values, so the values the user
    declined before no longer stand, and the bank sending them again is a change like any other
    """
    for field, columns in EDITABLE_COLUMNS.items():
        if field in fields:
            setattr(record, columns.aligned, getattr(record, columns.observed))
    if "description" in fields:
        record.kept_description = None
    record.declined_observation = None
