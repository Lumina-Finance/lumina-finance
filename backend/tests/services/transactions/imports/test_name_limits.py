"""Errors the shared merchant and tag name checks raise before any name is written

Both refuse a name too long for its column, which the request schema also refuses before a route
ever sees it, so calling the function directly is what reaches either raise.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.services.importers.shared.merchants import ImportMerchants, create_missing_import_merchants
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import create_missing_import_tags
from tests.conftest import TestSession


async def test_a_merchant_name_over_the_column_limit_is_refused():
    """A 300-character merchant name raises before anything is inserted."""
    async with TestSession() as session:
        name = "A" * 300
        merchants = ImportMerchants(existing_by_name_key={})

        with pytest.raises(HTTPException) as exc_info:
            await create_missing_import_merchants(session, uuid.uuid4(), [name], [], merchants, ImportStats())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == f"Merchant name is too long: {name[:28]}"


async def test_a_tag_name_over_the_column_limit_is_refused():
    """A 65-character tag name raises before anything is inserted."""
    async with TestSession() as session:
        name = "B" * 65

        with pytest.raises(HTTPException) as exc_info:
            await create_missing_import_tags(session, uuid.uuid4(), [name], {}, ImportStats())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == f"Tag name is too long: {name[:28]}"
