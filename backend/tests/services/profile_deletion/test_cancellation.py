"""Cancelling a waiting deletion against the run that deletes it: one wins, and the profile is never left half deleted"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.account import Account
from app.models.user import User
from app.services.profile_deletion import cancel_profile_deletion, delete_profile
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.identity_helpers import _act_as
from tests.routes.support.profile_deletion_helpers import _commit_user, _stored_marks


async def _cancel(user_id: uuid.UUID) -> User:
    """Cancel the deletion as the user, the way the route does"""
    async with _act_as(user_id) as db:
        user = await db.get(User, user_id)
        return await cancel_profile_deletion(db, user)


async def _accounts(user_id: uuid.UUID) -> int:
    """How many accounts the user still owns"""
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(Account).where(Account.owner_id == user_id))


async def test_a_cancel_and_a_run_at_once_before_the_due_time_leave_the_profile_intact(profile_deletions):
    """The run leaves a profile that is not due alone, and the cancel clears its three columns"""
    now = datetime.now(UTC)
    user = await _commit_user("waiting@example.com", requested_at=now, due_at=now + timedelta(hours=1), reminder_sent_at=now, with_account=True)

    cancelled, _ = await asyncio.gather(_cancel(user.id), delete_profile(ScopedSession, user.id))

    assert cancelled.deletion_due_at is None
    assert await _stored_marks(user) == (None, None, None)
    assert await _accounts(user.id) == 1
    assert profile_deletions == []


async def test_a_cancel_and_a_run_at_once_after_the_due_time_leave_a_deleted_profile(profile_deletions):
    """Once the due time has passed the cancel is refused with a conflict, and the run deletes everything"""
    now = datetime.now(UTC)
    user = await _commit_user("due@example.com", requested_at=now - timedelta(days=7), due_at=now - timedelta(minutes=1), with_account=True)

    results = await asyncio.gather(_cancel(user.id), delete_profile(ScopedSession, user.id), return_exceptions=True)

    assert isinstance(results[0], HTTPException) and results[0].status_code == 409
    assert results[0].detail == "Your profile is not waiting to be deleted"
    assert await _stored_marks(user) is None
    assert await _accounts(user.id) == 0
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]


@pytest.mark.parametrize("cancel_first", [True, False], ids=["cancel first", "run first"])
async def test_a_cancel_and_a_run_at_the_due_moment_never_leave_a_half_deleted_profile(profile_deletions, cancel_first):
    """With the due time a moment away and both acting around it, the profile is cancelled whole, gone with its data, or whole and still due"""
    now = datetime.now(UTC)
    user = await _commit_user("moment@example.com", requested_at=now, due_at=now + timedelta(milliseconds=300), with_account=True)

    async def cancel_around_the_moment() -> User:
        await asyncio.sleep(0.25 if cancel_first else 0.35)
        return await _cancel(user.id)

    async def run_around_the_moment() -> None:
        await asyncio.sleep(0.35 if cancel_first else 0.25)
        await delete_profile(ScopedSession, user.id)

    results = await asyncio.gather(cancel_around_the_moment(), run_around_the_moment(), return_exceptions=True)

    marks = await _stored_marks(user)
    if marks is None:
        assert isinstance(results[0], HTTPException), "a cancel that lost the race is refused"
        assert await _accounts(user.id) == 0
        assert [deletion.user_id for deletion in profile_deletions] == [user.id]
    elif isinstance(results[0], User):
        assert marks == (None, None, None), "a cancel that won clears the marks"
        assert await _accounts(user.id) == 1
        assert profile_deletions == []
    else:
        # The run came before the due time, so nothing was deleted, and the cancel came after it
        assert isinstance(results[0], HTTPException) and marks[1] is not None, "a refused cancel leaves the deletion due"
        assert await _accounts(user.id) == 1
        assert profile_deletions == []
