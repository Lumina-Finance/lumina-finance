"""The edited-field rule and whether a provider observation changes a bank transaction

A field wrongly read as unedited would let a trusted correction overwrite what the user typed, and
a declined proposal read as new would put the same correction back in front of them every sync
"""

import uuid
from datetime import date

from app.models.bank_transaction import BankTransactionDisposition
from app.services.bank_sync.review_state import BankObservation, changed_fields, edited_fields
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    BANK_DESCRIPTION,
    _build_account,
    _build_bank_transaction,
    _build_ledger_transaction,
)


def _accepted(amount: int = -1250):
    """Return an accepted record aligned with the bank's date and amount"""
    account = _build_account(uuid.uuid4())
    return _build_bank_transaction(account, amount=amount, transaction=_build_ledger_transaction(account, uuid.uuid4()))


def _observation(**changes) -> BankObservation:
    """Return the bank's observation of the helper's record, with some values changed"""
    values = {"date": BANK_DATE, "amount": -1250, "raw_amount": None, "description": BANK_DESCRIPTION}
    return BankObservation(**{**values, **changes})


def test_edited_fields_amount_added_differently_is_edited():
    """A $12.50 debit added as $10.00 reads amount as edited and date as not"""
    assert edited_fields(_accepted(-1250), BANK_DATE, -1000) == ["amount"]


def test_edited_fields_amount_edited_back_is_no_longer_edited():
    """Editing the ledger amount back to the bank's $12.50 debit clears the edit"""
    assert edited_fields(_accepted(-1250), BANK_DATE, -1250) == []


def test_edited_fields_both_fields_moved_reads_both_in_display_order():
    """A ledger row moved a day and changed in amount reads date then amount"""
    assert edited_fields(_accepted(-1250), date(2026, 10, 2), -900) == ["date", "amount"]


def test_edited_fields_amount_the_bank_could_not_give_is_edited():
    """An amount the user had to enter, because the bank's couldn't be stored, counts as theirs"""
    record = _accepted()
    record.observed_amount = None
    record.raw_amount = "-12.505"
    record.aligned_amount = None

    assert edited_fields(record, BANK_DATE, -1251) == ["amount"]


def test_edited_fields_record_not_accepted_reads_nothing_edited():
    """A record still waiting has no ledger row to differ from the bank"""
    record = _build_bank_transaction(_build_account(uuid.uuid4()))

    assert edited_fields(record, BANK_DATE, -1000) == []


def test_changed_fields_repeat_of_a_declined_proposal_changes_nothing():
    """Keep current value on a move from 3 to 4 October, then the bank sends 4 October again"""
    record = _accepted()
    record.declined_observation = _observation(date=date(2026, 10, 4)).to_json()
    record.aligned_date = date(2026, 10, 4)

    assert changed_fields(record, _observation(date=date(2026, 10, 4))) == []


def test_changed_fields_new_proposal_after_a_declined_one_reopens_review():
    """A date the user hasn't declined yet is a change again"""
    record = _accepted()
    record.declined_observation = _observation(date=date(2026, 10, 4)).to_json()

    assert changed_fields(record, _observation(date=date(2026, 10, 5))) == ["date"]


def test_changed_fields_amount_and_description_changes_are_reported():
    """An amount the bank now sends as written, and a new description, are both changes"""
    incoming = _observation(amount=None, raw_amount="-12.505", description="HARBOUR COFFEE")

    assert changed_fields(_accepted(), incoming) == ["amount", "description"]


def test_changed_fields_repeat_of_the_stored_observation_changes_nothing():
    """Repeated delivery of what is already stored is no change"""
    assert changed_fields(_accepted(), _observation()) == []


def test_changed_fields_dismissed_record_stays_dismissed_whatever_the_bank_sends():
    """A dismissed coffee item resent next week with a new description doesn't reappear"""
    record = _build_bank_transaction(_build_account(uuid.uuid4()))
    record.disposition = BankTransactionDisposition.DISMISSED

    assert changed_fields(record, _observation(description="HARBOUR COFFEE #2")) == []
