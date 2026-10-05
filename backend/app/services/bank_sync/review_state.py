"""The rules that read a bank transaction's review state

Which ledger fields count as edited, and the bank values a correction compares and stores, are
worked out here from the stored record, so the transaction responses, ingestion and the review
actions all apply the same rule
"""

from collections.abc import Collection
from datetime import date
from typing import Any, NamedTuple

from app.models.bank_transaction import BankTransaction, CorrectableBankField, EditableBankField


class EditableColumns(NamedTuple):
    """Where an editable field's value sits on the ledger row and on its bank transaction"""

    ledger: str
    aligned: str
    observed: str


EDITABLE_COLUMNS: dict[EditableBankField, EditableColumns] = {
    "date": EditableColumns("dt", "aligned_date", "observed_date"),
    "amount": EditableColumns("amount", "aligned_amount", "observed_amount"),
}


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


def align_with_bank(record: BankTransaction, fields: Collection[str]) -> None:
    """Align the named editable fields with the bank's latest values, so each counts as edited only while the ledger differs from them"""
    for field, columns in EDITABLE_COLUMNS.items():
        if field in fields:
            setattr(record, columns.aligned, getattr(record, columns.observed))
