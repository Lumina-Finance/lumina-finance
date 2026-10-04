"""Per-account review preferences

An account that read the wrong choice would either apply bank changes the user asked to review,
or hold back ones they chose to trust
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.account import Account
from app.models.account_review_preference import AccountReviewPreference, ReviewDecision
from app.models.base import AccountKind, AccountType
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.services.bank_sync.review_preferences import (
    REVIEW_ALL,
    ReviewPreferences,
    get_review_preferences,
    update_review_preferences,
)
from tests.routes.support.bank_sync_helpers import _build_account, _build_user

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


async def test_review_preferences_group_account_the_user_administers_is_refused(db, everyday):
    """A joint account the user can see isn't theirs alone, so it has no preferences for them"""
    group = Group(owner_id=everyday.owner_id, name="Family")
    db.add(group)
    await db.flush()
    db.add(GroupMember(group_id=group.id, user_id=everyday.owner_id, is_admin=True))
    joint = Account(group_id=group.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Joint", currency="CAD")
    db.add(joint)
    await db.flush()

    with pytest.raises(HTTPException) as reading:
        await get_review_preferences(db, everyday.owner_id, joint.id)
    with pytest.raises(HTTPException) as changing:
        await update_review_preferences(db, everyday.owner_id, joint.id, removals=_TRUST)

    refusal = (403, "Review preferences are only available on your own accounts")
    assert (reading.value.status_code, reading.value.detail) == refusal
    assert (changing.value.status_code, changing.value.detail) == refusal
    assert await db.scalar(select(func.count()).select_from(AccountReviewPreference)) == 0
