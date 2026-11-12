"""The edited-field rule

A field wrongly read as unedited would pass off what the user typed as the bank's value, and one
wrongly read as edited would show the bank's own value as the user's
"""

import uuid
from datetime import date

from app.services.bank_sync.review_state import edited_fields
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    _build_account,
    _build_bank_transaction,
    _build_ledger_transaction,
)


def _accepted(amount: int = -1250):
    """Return an accepted record aligned with the bank's date and amount"""
    account = _build_account(uuid.uuid4())
    return _build_bank_transaction(account, amount=amount, transaction=_build_ledger_transaction(account, uuid.uuid4()))


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
