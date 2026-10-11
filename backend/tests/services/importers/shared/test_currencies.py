"""Errors the shared currency lookup raises for a code this app has not seeded

It reads the currency table directly, so no account, mapping or user is needed to reach its raise: an
unseeded code is enough on its own, and staging re-runs the same lookup before a request carrying one
would reach the route.
"""

import pytest
from fastapi import HTTPException

from app.services.importers.shared.currencies import get_import_currencies_by_code
from tests.conftest import TestSession


async def test_a_currency_code_no_account_uses_yet_is_reported_missing():
    """Looking up an unseeded currency code raises rather than silently dropping it."""
    async with TestSession() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_import_currencies_by_code(session, {"ZZZ"})

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Invalid currency code: ZZZ"
