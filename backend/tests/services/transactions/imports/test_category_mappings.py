"""Errors the shared category-source resolver raises directly

Each of these skips a request and calls the shared function on its own, since staging re-runs the
same checks and the schema refuses an unsupported kind before a request carrying either shape
reaches the route.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.user import User
from app.schemas.transaction import TransactionImportCategoryMapping
from app.services.importers.shared.categories import (
    get_or_create_import_categories_by_source,
    get_visible_import_category,
    parse_import_category_kind,
)
from app.services.importers.shared.stats import ImportStats
from tests.conftest import TestSession


async def _seed_user(session) -> User:
    """Insert the user the category sources resolve for

    Args:
        session: Database session the test runs in

    Returns:
        The seeded user
    """
    session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = User(
        email="category-mappings-import@example.com",
        first_name="Import",
        tz="America/Toronto",
        base_currency="CAD",
    )
    session.add(user)
    await session.flush()
    return user


async def test_naming_one_source_twice_is_refused_once_the_first_mapping_has_resolved():
    """A second mapping for a source already resolved raises before its own action is even read."""
    async with TestSession() as session:
        user = await _seed_user(session)
        category = Category(owner_id=user.id, group_id=None, name="Groceries", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        mappings = [
            TransactionImportCategoryMapping(source="Groceries", category_id=category.id),
            TransactionImportCategoryMapping(source="Groceries", category_id=category.id),
        ]

        with pytest.raises(HTTPException) as exc_info:
            await get_or_create_import_categories_by_source(session, user, mappings, ImportStats())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Duplicate category source: Groceries"


async def test_a_category_id_matching_nothing_visible_is_reported_not_found():
    """Looking up a random category ID raises the same not-found error as a mismatched one."""
    async with TestSession() as session:
        user = await _seed_user(session)

        with pytest.raises(HTTPException) as exc_info:
            await get_visible_import_category(session, uuid.uuid4(), user.id)

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Category not found"


def test_an_unsupported_category_kind_is_refused():
    """Parsing a kind this app does not define raises without touching the database."""
    with pytest.raises(HTTPException) as exc_info:
        parse_import_category_kind("savings")

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Invalid category kind"
