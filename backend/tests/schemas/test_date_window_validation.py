"""Date window tests for each request field that takes a date the app stores"""

import uuid
from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from app.schemas.bank_review import BulkAddReviewItemsRequest
from app.schemas.budget import CreateBaseBudgetRequest, CreateBudgetRequest
from app.schemas.import_run import JournalBudgetLimit, JournalTransactionRow, TransactionImportStageRow
from app.schemas.transaction import BulkUpdateTransactionsRequest, TransactionEntry, UpdateTransactionRequest
from app.utils import date_window

# The window's last day, counted from the furthest-ahead calendar's today, with the clock frozen
LATEST_ALLOWED = date(2036, 6, 10)
FROZEN_MOMENT = datetime(2026, 6, 9, 23, 30, tzinfo=UTC)

DATE_FIELD_MODELS = [
    pytest.param(TransactionEntry, {"merchant_id": uuid.uuid4(), "category_id": uuid.uuid4(), "amount": -500}, id="create-transaction"),
    pytest.param(UpdateTransactionRequest, {}, id="update-transaction"),
    pytest.param(BulkUpdateTransactionsRequest, {"transaction_ids": [uuid.uuid4()]}, id="bulk-update-transactions"),
    pytest.param(
        BulkAddReviewItemsRequest,
        {"items": [{"id": uuid.uuid4(), "version": 1}], "merchant_id": uuid.uuid4(), "category_id": uuid.uuid4()},
        id="bulk-add-review-items",
    ),
    pytest.param(
        TransactionImportStageRow,
        {"account_source": "Chequing", "category_source": "Food", "amount": "-5.00"},
        id="import-row",
    ),
    pytest.param(
        JournalTransactionRow,
        {"journal_id": "1", "type": "withdrawal", "amount": "5.00", "currency_code": "CAD"},
        id="journal-row",
    ),
]


@pytest.fixture(autouse=True)
def frozen_clock(freeze_now) -> None:
    """Fix the moment the window's last day is counted from"""
    freeze_now(date_window, FROZEN_MOMENT)


@pytest.mark.parametrize(("model", "fields"), DATE_FIELD_MODELS)
@pytest.mark.parametrize("accepted", [date(1900, 1, 1), date(2026, 3, 15), LATEST_ALLOWED])
def test_date_field_accepts_the_window_and_both_of_its_edges(model, fields, accepted):
    """A date from 1 January 1900 to ten years after today is taken as sent"""
    assert model(**fields, dt=accepted).dt == accepted


@pytest.mark.parametrize(("model", "fields"), DATE_FIELD_MODELS)
@pytest.mark.parametrize(
    ("refused", "message"),
    [
        (date(1899, 12, 31), "Date must be on or after 1 January 1900"),
        (date(1, 1, 1), "Date must be on or after 1 January 1900"),
        (date(2036, 6, 11), "Date must be within ten years of today"),
        (date(9999, 12, 31), "Date must be within ten years of today"),
    ],
)
def test_date_field_refuses_a_day_outside_the_window_with_the_reason_on_the_field(model, fields, refused, message):
    """A day past either edge is refused, and the error's location is the date field"""
    with pytest.raises(ValidationError) as refusal:
        model(**fields, dt=refused)

    [error] = refusal.value.errors()
    assert error["loc"] == ("dt",)
    assert error["msg"] == message


BUDGET_DATE_FIELDS = [
    pytest.param(
        CreateBaseBudgetRequest,
        {
            "name": "Groceries",
            "currency": "CAD",
            "recurrence_freq": "monthly",
            "recurrence_dom": 1,
            "category_ids": [uuid.uuid4()],
            "overall_limit": 5000,
        },
        "period_start",
        id="create-base-budget",
    ),
    pytest.param(CreateBudgetRequest, {"overall_limit": 5000}, "period_start", id="create-budget-period"),
    pytest.param(JournalBudgetLimit, {"amount": "10.00", "end": date(2026, 1, 31)}, "start", id="journal-limit-start"),
    pytest.param(JournalBudgetLimit, {"amount": "10.00", "start": date(2026, 1, 1)}, "end", id="journal-limit-end"),
]


@pytest.mark.parametrize(("model", "fields", "field"), BUDGET_DATE_FIELDS)
@pytest.mark.parametrize("accepted", [date(1900, 1, 1), date(2024, 1, 1), LATEST_ALLOWED])
def test_budget_date_field_accepts_the_window_and_both_of_its_edges(model, fields, field, accepted):
    """A budget date from 1 January 1900 to ten years after today is taken as sent"""
    assert getattr(model(**fields, **{field: accepted}), field) == accepted


@pytest.mark.parametrize(("model", "fields", "field"), BUDGET_DATE_FIELDS)
@pytest.mark.parametrize(
    ("refused", "message"),
    [
        (date(1899, 12, 31), "Date must be on or after 1 January 1900"),
        (date(1850, 1, 1), "Date must be on or after 1 January 1900"),
        (date(2036, 6, 11), "Date must be within ten years of today"),
        (date(2040, 1, 1), "Date must be within ten years of today"),
    ],
)
def test_budget_date_field_refuses_a_day_outside_the_window_with_the_reason_on_the_field(model, fields, field, refused, message):
    """A budget date past either edge is refused, and the error's location is that date field"""
    with pytest.raises(ValidationError) as refusal:
        model(**fields, **{field: refused})

    [error] = refusal.value.errors()
    assert error["loc"] == (field,)
    assert error["msg"] == message
