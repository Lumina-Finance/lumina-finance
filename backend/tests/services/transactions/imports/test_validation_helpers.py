import pytest
from fastapi import HTTPException

from app.services.transactions.imports.validation_helpers import strip_import_text_or_raise


def test_strip_import_text_or_raise_returns_cleaned_text():
    """Import text validation strips surrounding whitespace"""
    cleaned_text = strip_import_text_or_raise("  Main Chequing  ", "Account source")

    assert cleaned_text == "Main Chequing"


def test_strip_import_text_or_raise_rejects_blank_text():
    """Import text validation raises a 422 error for blank text"""
    with pytest.raises(HTTPException) as exc_info:
        strip_import_text_or_raise("   ", "Account source")

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Account source cannot be blank"
