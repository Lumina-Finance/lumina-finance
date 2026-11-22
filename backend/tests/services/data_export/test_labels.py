"""A cell holds the word a screen shows for a stored value"""

from app.models.bank_connection import BankLinkState
from app.models.bank_transaction import BankTransactionDisposition
from app.models.base import AccountKind, AccountType, CategoryKind, RecurrenceFreq, TaxTreatment
from app.models.import_run import ImportRunSource
from app.models.saved_insights_range import SAVED_INSIGHTS_RANGE_QUALIFIERS
from app.preferences import DATE_FORMATS
from app.services.data_export import labels


def test_budget_anchors_are_named_from_monday_and_january():
    """A weekly budget's stored 0 is Monday and a yearly budget's 12 is December."""
    assert labels.label(labels.WEEKDAYS, 0) == "Monday"
    assert labels.label(labels.WEEKDAYS, 6) == "Sunday"
    assert labels.label(labels.MONTHS, 12) == "December"


def test_an_empty_or_unknown_value_is_left_as_stored():
    """A budget with no weekday stays empty and a value added later still reaches the file."""
    assert labels.label(labels.WEEKDAYS, None) is None
    assert labels.label(labels.ACCOUNT_TYPES, "brand_new_type") == "brand_new_type"


def test_every_stored_value_a_file_writes_has_a_word():
    """A value the app can store without a word here would reach a file as a code."""
    assert {value.value for value in AccountKind} == set(labels.ACCOUNT_KINDS)
    assert {value.value for value in AccountType} == set(labels.ACCOUNT_TYPES)
    assert {value.value for value in CategoryKind} == set(labels.CATEGORY_KINDS)
    assert {value.value for value in RecurrenceFreq} == set(labels.RECURRENCE_FREQUENCIES)
    assert {value.value for value in ImportRunSource} == set(labels.IMPORT_SOURCES)
    assert set(DATE_FORMATS) == set(labels.DATE_FORMATS)
    assert set(SAVED_INSIGHTS_RANGE_QUALIFIERS) == set(labels.INSIGHTS_QUALIFIERS)
    assert {value.value for value in BankLinkState} == set(labels.BANK_LINK_STATES)
    assert {value.value for value in BankTransactionDisposition} == set(labels.BANK_REVIEW_STATUSES)

    # Taxable is a treatment an account can't be given here, so no screen offers it for a tax-advantaged category
    assert {value.value for value in TaxTreatment} - {"taxable"} == set(labels.TAX_TREATMENTS)
