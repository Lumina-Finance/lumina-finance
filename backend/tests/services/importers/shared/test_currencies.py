"""Errors the shared currency checks raise for a code this app has not seeded

Both read the currency table directly, so no account, mapping or user is needed to reach either
raise: an unseeded code is enough on its own, and staging re-runs the same lookups before a request
carrying one would reach the route.
"""

import pytest
from fastapi import HTTPException

from app.services.importers.shared.account_creation_helpers import validate_import_account_currency
from app.services.importers.shared.currencies import get_import_currencies_by_code
from tests.conftest import TestSession


async def test_a_currency_code_no_account_uses_yet_is_reported_missing():
    """Looking up an unseeded currency code raises rather than silently dropping it."""
    async with TestSession() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_import_currencies_by_code(session, {"ZZZ"})

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Invalid currency code: ZZZ"


async def test_creating_an_account_in_an_unseeded_currency_is_refused():
    """Validating a currency code for a create-account mapping raises the same way."""
    async with TestSession() as session:
        with pytest.raises(HTTPException) as exc_info:
            await validate_import_account_currency(session, "ZZZ")

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Invalid currency code: ZZZ"
