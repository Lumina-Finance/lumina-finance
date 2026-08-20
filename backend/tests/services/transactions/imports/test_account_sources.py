"""Errors the shared account-source resolver raises before any account query

Both branches are refused by validating the payload's shape alone, so calling the function directly
is what reaches them: staging re-runs the same checks, and the schema refuses an over-long source
name before a request carrying either shape reaches the route.
"""

import pytest
from fastapi import HTTPException

from app.models.currency import Currency
from app.models.user import User
from app.schemas.transaction import TransactionImportAccountMapping
from app.services.importers.shared.accounts import resolve_import_account_sources
from app.services.importers.shared.stats import ImportStats
from tests.conftest import TestSession


async def _seed_user(session) -> User:
    """Insert the user the account sources resolve for

    Args:
        session: Database session the test runs in

    Returns:
        The seeded user
    """
    session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = User(
        email="account-sources-import@example.com",
        first_name="Import",
        tz="America/Toronto",
        base_currency="CAD",
    )
    session.add(user)
    await session.flush()
    return user


async def test_naming_one_source_twice_as_outside_money_is_refused_as_a_duplicate():
    """Two mappings answering the same source as outside the tracked accounts raise on the second."""
    async with TestSession() as session:
        user = await _seed_user(session)
        mapping = TransactionImportAccountMapping(source="Cash", outside=True)

        with pytest.raises(HTTPException) as exc_info:
            await resolve_import_account_sources(session, user, [mapping, mapping], ImportStats(), set())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Duplicate account source: Cash"


async def test_a_mapping_naming_no_account_and_no_create_is_refused():
    """A source mapped to neither an existing account nor a new one raises before any account query."""
    async with TestSession() as session:
        user = await _seed_user(session)
        mapping = TransactionImportAccountMapping(source="Chequing")

        with pytest.raises(HTTPException) as exc_info:
            await resolve_import_account_sources(session, user, [mapping], ImportStats(), set())

        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Account source must map to exactly one account action: Chequing"
