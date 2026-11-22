"""Import run budgets request schema tests"""

import pytest
from pydantic import ValidationError

from app.schemas.import_run import ImportRunBudgetsRequest


def test_a_budgets_part_starts_at_zero_or_later():
    """A part's start index defaults to zero and is never below it."""
    assert ImportRunBudgetsRequest().start_index == 0
    assert ImportRunBudgetsRequest(start_index=3).start_index == 3

    with pytest.raises(ValidationError):
        ImportRunBudgetsRequest(start_index=-1)
