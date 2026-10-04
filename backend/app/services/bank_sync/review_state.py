"""The rules that read a bank transaction's review state

Which ledger fields count as edited, and whether a provider observation changes anything review
looks at, are worked out here from the stored record, so the transaction responses, ingestion and
the review actions all apply the same rule
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from app.models.bank_transaction import BankTransaction, BankTransactionDisposition

# The bank fields a ledger row can differ from. The ledger has no description column, so the raw
# bank description is always shown read-only and can't be edited
EditableBankField = Literal["date", "amount"]

# The fields whose change opens a correction on an accepted record. A change to only the merchant
# name or category hint updates the stored observation without one
ReviewedBankField = Literal["date", "amount", "description"]


@dataclass(frozen=True)
class BankObservation:
    """What a provider observation says about the fields review compares

    The amount is in the account currency's minor units, or None with the bank's amount exactly
    as sent when it can't be stored exactly
    """

    date: date
    amount: int | None
    raw_amount: str | None
    description: str

    def to_json(self) -> dict[str, Any]:
        """Return the observation as stored in a record's JSON columns"""
        return {
            "date": self.date.isoformat(),
            "amount": self.amount,
            "raw_amount": self.raw_amount,
            "description": self.description,
        }

    @classmethod
    def from_json(cls, stored: dict[str, Any]) -> BankObservation:
        """Read an observation back from a record's JSON column"""
        return cls(
            date=date.fromisoformat(stored["date"]),
            amount=stored["amount"],
            raw_amount=stored["raw_amount"],
            description=stored["description"],
        )


def edited_fields(record: BankTransaction, ledger_date: date, ledger_amount: int) -> list[EditableBankField]:
    """Return the fields the ledger row holds differently from the bank values it was last aligned with

    Args:
        record: The bank transaction the ledger row came from
        ledger_date: The ledger row's date
        ledger_amount: The ledger row's amount in minor units

    Returns:
        The edited fields, in display order, or none for a record that isn't accepted
    """
    if record.disposition != BankTransactionDisposition.ACCEPTED:
        return []
    edited: list[EditableBankField] = []
    if ledger_date != record.aligned_date:
        edited.append("date")

    # An amount the bank couldn't give exactly was entered by the user, so it is theirs
    if record.aligned_amount is None or ledger_amount != record.aligned_amount:
        edited.append("amount")
    return edited


def changed_fields(record: BankTransaction, incoming: BankObservation) -> list[ReviewedBankField]:
    """Return the reviewed fields a new provider observation changes on a record

    An observation the user already declined with Keep current value changes nothing, so the same
    proposal delivered again doesn't reopen review. A dismissed record holds nothing to compare
    and stays dismissed

    Args:
        record: The stored bank transaction
        incoming: What the provider reports now

    Returns:
        The changed fields, in display order
    """
    if record.disposition == BankTransactionDisposition.DISMISSED:
        return []
    if record.declined_observation is not None and BankObservation.from_json(record.declined_observation) == incoming:
        return []
    changed: list[ReviewedBankField] = []
    if incoming.date != record.observed_date:
        changed.append("date")
    if (incoming.amount, incoming.raw_amount) != (record.observed_amount, record.raw_amount):
        changed.append("amount")
    if incoming.description != record.description:
        changed.append("description")
    return changed
