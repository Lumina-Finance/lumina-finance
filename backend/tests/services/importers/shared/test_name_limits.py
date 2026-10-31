"""Errors the shared merchant and tag name checks raise before any name is written

Both refuse a name too long for its column, which the request schema also refuses before a route
ever sees it, so calling the function directly is what reaches either raise.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.schemas.import_run import TransactionImportTagMapping
from app.services.importers.shared.merchants import ImportMerchants, create_missing_import_merchants
from app.services.importers.shared.name_keys import load_import_name_keys
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import ImportTags, create_missing_import_tags
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


async def test_merchant_keys_for_a_file_of_every_size_are_worked_out_by_the_database():
    """A file's merchant names go to the database as one parameter, past the driver's limit on parameters."""
    async with TestSession() as session:
        names = [f"Merchant {index}" for index in range(40_000)] + ["İstanbul Kebap"]

        keys = await load_import_name_keys(session, names)

        assert len(keys) == 40_001
        assert keys["İstanbul Kebap"] == "istanbul kebap"


async def test_a_tag_name_over_the_column_limit_is_refused():
    """A 65-character tag name raises before anything is inserted."""
    async with TestSession() as session:
        name = "B" * 65

        with pytest.raises(HTTPException) as exc_info:
            await create_missing_import_tags(session, uuid.uuid4(), [name], [], ImportTags(existing_by_key={}), ImportStats())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == f"Tag name is too long: {name[:28]}"


async def test_two_answers_for_one_tag_name_are_refused_at_the_commit_too():
    """A run cannot hold the pair, so only a request built by hand reaches this, and it still writes nothing."""
    async with TestSession() as session:
        answers = [TransactionImportTagMapping(source="Trip", skip=True), TransactionImportTagMapping(source="TRIP", create={"name": "Travel"})]

        with pytest.raises(HTTPException) as exc_info:
            await create_missing_import_tags(session, uuid.uuid4(), ["Trip"], answers, ImportTags(existing_by_key={}), ImportStats())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "The tag source TRIP is answered twice"


async def test_an_answer_pointing_at_a_tag_that_is_gone_is_refused_at_the_commit():
    """A tag deleted between staging and the commit is refused, rather than filing rows under nothing."""
    async with TestSession() as session:
        answers = [TransactionImportTagMapping(source="Trip", tag_id=uuid.uuid4())]

        with pytest.raises(HTTPException) as exc_info:
            await create_missing_import_tags(session, uuid.uuid4(), ["Trip"], answers, ImportTags(existing_by_key={}), ImportStats())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Tag not found"
