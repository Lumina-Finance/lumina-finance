"""Per-account review preferences

An account that read the wrong choice would either apply bank changes the user asked to review,
or hold back ones they chose to trust
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, update

from app.models.account_review_preference import ReviewDecision
from app.models.bank_connection import BankAccountLink, BankLinkState
from app.models.currency import Currency
from app.services.bank_sync.review_preferences import (
    REVIEW_ALL,
    ReviewPreferences,
    get_review_preferences,
    update_review_preferences,
)
from tests.routes.support.bank_sync_helpers import _build_account, _build_bank_connection, _build_bank_link, _build_user

_REVIEW = ReviewDecision.REVIEW
_TRUST = ReviewDecision.TRUST


@pytest.fixture
async def everyday(db):
    """Add a user with one account, returning the account"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()
    user = _build_user("prefs@example.com")
    db.add(user)
    await db.flush()
    account = _build_account(user.id)
    db.add(account)
    await db.flush()
    return account


async def test_review_preferences_account_never_changed_reads_review_all(db, everyday):
    """An account with nothing stored reads Review for all three, so no backfill is needed"""
    assert await get_review_preferences(db, everyday.owner_id, everyday.id) == REVIEW_ALL


async def test_review_preferences_update_of_one_choice_leaves_the_others(db, everyday):
    """Setting corrections to Trust keeps the other two on Review, and a later change keeps it"""
    after_first = await update_review_preferences(db, everyday.owner_id, everyday.id, corrections=_TRUST)
    after_second = await update_review_preferences(db, everyday.owner_id, everyday.id, new_transactions=_TRUST)

    assert after_first == ReviewPreferences(new_transactions=_REVIEW, corrections=_TRUST, removals=_REVIEW)
    assert after_second == ReviewPreferences(new_transactions=_TRUST, corrections=_TRUST, removals=_REVIEW)
    assert await get_review_preferences(db, everyday.owner_id, everyday.id) == after_second


async def test_review_preferences_survive_linking_another_bank_account(db, everyday):
    """Auto-approve all on Everyday still reads Trust after it is unlinked and linked elsewhere"""
    connection = _build_bank_connection(everyday.owner_id)
    db.add(connection)
    await db.flush()
    first_link = _build_bank_link(everyday, connection, "ACT-1")
    db.add(first_link)
    await db.flush()
    await update_review_preferences(
        db,
        everyday.owner_id,
        everyday.id,
        new_transactions=_TRUST,
        corrections=_TRUST,
        removals=_TRUST,
    )

    await db.execute(
        update(BankAccountLink).where(BankAccountLink.id == first_link.id).values(state=BankLinkState.UNLINKED, unlinked_at=func.now())
    )
    db.add(_build_bank_link(everyday, connection, "ACT-2"))
    await db.flush()

    assert await get_review_preferences(db, everyday.owner_id, everyday.id) == ReviewPreferences(_TRUST, _TRUST, _TRUST)


async def test_review_preferences_another_users_account_is_not_found(db, everyday):
    """Only the account's owner reads or changes its choices"""
    other = _build_user("other@example.com")
    db.add(other)
    await db.flush()

    with pytest.raises(HTTPException) as reading:
        await get_review_preferences(db, other.id, everyday.id)
    with pytest.raises(HTTPException) as changing:
        await update_review_preferences(db, other.id, everyday.id, removals=_TRUST)

    assert (reading.value.status_code, reading.value.detail) == (404, "Account not found")
    assert (changing.value.status_code, changing.value.detail) == (404, "Account not found")
    assert await get_review_preferences(db, everyday.owner_id, everyday.id) == REVIEW_ALL
