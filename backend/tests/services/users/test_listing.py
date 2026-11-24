"""Listing every user in batches for code built on the app, with when each signed up and last signed in"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import update
from sqlalchemy.exc import DBAPIError

from app.models.user import User, UserLastSignIn
from app.services.users import listing
from app.services.users.listing import UserSummary, list_users
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.identity_helpers import _act_as, _seed_users

_SIGNED_UP = datetime(2026, 3, 1, 14, 0, tzinfo=UTC)
_SIGNED_IN = datetime(2026, 3, 20, 9, 30, tzinfo=UTC)


async def test_users_come_in_id_order_batches_that_end_with_a_short_one(monkeypatch):
    """Each batch starts after the last one's final id, a user being deleted is left out, and a user with no recorded sign-in shows none"""
    monkeypatch.setattr(listing, "USER_LIST_BATCH_SIZE", 2)
    users = await _seed_users("a@example.com", "b@example.com", "c@example.com", "gone@example.com")
    gone = next(user for user in users if user.email == "gone@example.com")
    kept = sorted((user for user in users if user is not gone), key=lambda user: user.id)
    async with TestSession() as session:
        await session.execute(update(User).values(created_at=_SIGNED_UP))
        await session.execute(update(User).where(User.id == gone.id).values(deletion_requested_at=_SIGNED_IN))
        session.add(UserLastSignIn(user_id=kept[0].id, last_signed_in_at=_SIGNED_IN))
        await session.commit()

    first = await list_users(session_factory=ScopedSession)
    second = await list_users(after=first[-1].user_id, session_factory=ScopedSession)

    assert first == [
        UserSummary(user_id=kept[0].id, email=kept[0].email, signed_up_at=_SIGNED_UP, last_signed_in_at=_SIGNED_IN),
        UserSummary(user_id=kept[1].id, email=kept[1].email, signed_up_at=_SIGNED_UP, last_signed_in_at=None),
    ], "a full batch holds the first users in id order"
    assert [summary.user_id for summary in second] == [kept[2].id], "the last batch is short and leaves out the user being deleted"
    assert await list_users(after=kept[2].id, session_factory=ScopedSession) == [], "nothing comes after the last user"


async def test_listing_users_is_refused_under_a_user_identity():
    """Only code with no request identity may see across users, so a request can never list them"""
    (user,) = await _seed_users("asker@example.com")

    with pytest.raises(DBAPIError, match="Only code with no request identity may list users"):
        async with _act_as(user.id):
            await list_users(session_factory=ScopedSession)
