"""Errors the shared row-mapping lookups raise without a database

Both read only the arguments handed to them, so building a category and an account in memory and
calling the function directly reaches branches a route test cannot: the schema and staging refuse
these shapes before a request carrying either would reach the route.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.models.account import Account
from app.models.category import Category
from app.services.importers.shared.row_mappings import (
    get_import_row_category,
    validate_import_category_can_be_used_for_account,
)


def test_a_row_naming_a_category_source_the_payload_never_declared_is_refused():
    """A category source absent from the declared mappings raises rather than matching nothing quietly."""
    with pytest.raises(HTTPException) as exc_info:
        get_import_row_category({}, "Groceries")

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Category source is not mapped: Groceries"


def test_a_group_categorys_group_not_matching_the_accounts_is_refused():
    """A category belonging to one group cannot be used for an account belonging to a different one."""
    category = Category(group_id=uuid.uuid4(), owner_id=None, is_system=False)
    account = Account(group_id=uuid.uuid4())

    with pytest.raises(HTTPException) as exc_info:
        validate_import_category_can_be_used_for_account(category, account, uuid.uuid4())

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Category not found"
