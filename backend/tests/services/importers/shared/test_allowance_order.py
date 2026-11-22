"""The order the resolvers ask the allowance check in: the file's own mistakes are answered before any refusal

Staging refuses a source listed twice before a run is committed, so only a call to the resolver
reaches these. The user is told what to fix in their file rather than refused something the fixed file
may not ask for
"""

import pytest
from fastapi import HTTPException

from app.allowance_hook import AllowanceKind
from app.schemas.import_run import TransactionImportAccountMapping, TransactionImportCategoryMapping
from app.services.importers.shared.accounts import resolve_import_account_sources
from app.services.importers.shared.categories import get_or_create_import_categories_by_source
from app.services.importers.shared.stats import ImportStats
from tests.conftest import TestSession
from tests.routes.support.allowance_helpers import install_check
from tests.services.importers._helpers import _seed_user


async def test_accounts_listed_twice_answer_422_before_the_check_refuses_accounts():
    """The second mapping of a source is the file's mistake, even when the first would be refused"""
    install_check(refused={AllowanceKind.ACCOUNT})
    mapping = TransactionImportAccountMapping(source="Chequing", create={"name": "Chequing", "account_type": "checking", "currency": "CAD"})
    async with TestSession() as session:
        user = await _seed_user(session)

        with pytest.raises(HTTPException) as exc_info:
            await resolve_import_account_sources(session, user, [mapping, mapping], ImportStats(), set())

    assert (exc_info.value.status_code, exc_info.value.detail) == (422, "The account source Chequing is listed more than once")


async def test_categories_listed_twice_answer_422_before_the_check_refuses_categories():
    """The second mapping of a source is the file's mistake, even when the first would be refused"""
    install_check(refused={AllowanceKind.CATEGORY})
    mapping = TransactionImportCategoryMapping(source="Hobbies", create={"name": "Hobbies", "kind": "expense"})
    async with TestSession() as session:
        user = await _seed_user(session)

        with pytest.raises(HTTPException) as exc_info:
            await get_or_create_import_categories_by_source(session, user, [mapping, mapping], ImportStats())

    assert (exc_info.value.status_code, exc_info.value.detail) == (422, "The category source Hobbies is listed more than once")
