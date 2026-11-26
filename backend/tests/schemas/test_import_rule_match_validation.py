"""The rows the import page asks the rules about: how many one request may carry, and what a row may hold"""

import pytest
from pydantic import ValidationError

from app.schemas.import_rule import MatchImportRulesRequest
from app.schemas.import_run import MAX_IMPORT_BATCH_ROWS, MAX_IMPORT_TAGS_PER_ROW


def _row(**overrides) -> dict:
    """Return a row that is accepted"""
    return {
        "description": "AMAZON.CA",
        "note": None,
        "amount": "-20.00",
        "currency": "CAD",
        "account_id": None,
        "is_transfer": False,
    } | overrides


def test_a_request_carries_between_one_row_and_a_batch_of_them():
    """A batch of an import is the most one request holds, and a request with no rows asks nothing"""
    assert len(MatchImportRulesRequest(rows=[_row()] * MAX_IMPORT_BATCH_ROWS).rows) == MAX_IMPORT_BATCH_ROWS
    for rows in ([], [_row()] * (MAX_IMPORT_BATCH_ROWS + 1)):
        with pytest.raises(ValidationError):
            MatchImportRulesRequest(rows=rows)


@pytest.mark.parametrize(
    "overrides",
    [
        {"unexpected": 1},
        {"currency": "cad"},
        {"amount": ""},
        {"is_transfer": None},
        {"tag_names": ["tag"] * (MAX_IMPORT_TAGS_PER_ROW + 1)},
    ],
)
def test_a_row_with_a_field_this_version_does_not_take_or_a_value_it_cannot_hold_is_refused(overrides):
    """An unknown field is refused, not dropped, so a page from another version fails instead of being answered wrongly"""
    with pytest.raises(ValidationError):
        MatchImportRulesRequest(rows=[_row(**overrides)])


def test_a_request_with_a_field_this_version_does_not_take_is_refused():
    """The request itself takes only its rows"""
    with pytest.raises(ValidationError):
        MatchImportRulesRequest(rows=[_row()], unexpected=1)
