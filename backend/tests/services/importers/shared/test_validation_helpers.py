import pytest
from fastapi import HTTPException

from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


def test_strip_import_text_or_raise_rejects_blank_text():
    """Import text validation raises a 422 error for blank text"""
    with pytest.raises(HTTPException) as exc_info:
        strip_import_text_or_raise("   ", "Account source")

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Account source cannot be blank"
