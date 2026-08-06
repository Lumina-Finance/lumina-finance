"""Owner timezone lookup behind tax-advantaged category metrics"""

import uuid

import pytest
from fastapi import HTTPException, status

from app.services.tax_advantaged_categories import get_category_owner_timezones
from app.services.tax_advantaged_categories.tac_limit_metric_helpers import MISSING_CATEGORY_OWNER_DETAIL

# An owner identifier no user row carries. The lookup is a security-definer function that bypasses
# row-level security, so an empty answer means the row is gone rather than hidden from the caller
ABSENT_OWNER_ID = uuid.UUID("00000000-0000-0000-0000-0000000000ff")


async def test_an_absent_owner_row_is_refused(db):
    """A missing owner row refuses the request rather than building a zone out of nothing

    Tested here rather than through a route because a request whose own user row is gone fails
    authentication before any handler runs
    """
    with pytest.raises(HTTPException) as raised:
        await get_category_owner_timezones(db, {ABSENT_OWNER_ID})

    assert raised.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert raised.value.detail == MISSING_CATEGORY_OWNER_DETAIL


async def test_no_owner_ids_returns_an_empty_map(db):
    """A reader with no categories asks for no zones, which must not reach the database"""
    assert await get_category_owner_timezones(db, set()) == {}
