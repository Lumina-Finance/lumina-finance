"""Cancelling a waiting deletion against the run that deletes it: they take turns on the user row"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.services.profile_deletion import cancel_profile_deletion, delete_profile, removal
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.identity_helpers import _act_as
from tests.routes.support.profile_deletion_helpers import _commit_user, _stored_marks

_ALREADY_UNDER_WAY = "Your profile is already being deleted, so the deletion can no longer be cancelled"
_DEADLINE_SECONDS = 15
_POLL_SECONDS = 0.02


async def _cancel(user_id: uuid.UUID) -> User:
    """Cancel the deletion as the user, the way the route does"""
    async with _act_as(user_id) as db:
        user = await db.get(User, user_id)
        return await cancel_profile_deletion(db, user)


async def _accounts(user_id: uuid.UUID) -> int:
    """How many accounts the user still owns"""
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(Account).where(Account.owner_id == user_id))


async def _poll(condition: Callable[[], Awaitable[bool]], failure: str) -> None:
    """Wait until the condition holds, checking it over and over, and fail if it never does within the deadline"""
    deadline = asyncio.get_running_loop().time() + _DEADLINE_SECONDS
    while not await condition():
        assert asyncio.get_running_loop().time() < deadline, failure
        await asyncio.sleep(_POLL_SECONDS)


@asynccontextmanager
async def _holding_the_user_row(user_id: uuid.UUID) -> AsyncIterator[tuple[AsyncSession, Callable[[], Awaitable[bool]]]]:
    """Hold SELECT ... FOR NO KEY UPDATE on the user row in an open transaction until the block ends, then commit

    The weaker lock blocks another SELECT ... FOR UPDATE and a plain update of the row, but not the key-share
    locks other statements take through foreign keys, so what waits behind it is the lock under test and
    not some later statement of the same run

    Yields the holding session, for a test that changes the row before it lets go, and a check that is true
    once another transaction is queued behind the held row, which is what tells a test that a cancel or a
    run is waiting for the lock and has not simply finished
    """
    async with TestSession() as holder:
        await holder.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))
        held_by = await holder.scalar(text("SELECT pg_current_xact_id()::xid::text"))

        async def someone_is_waiting() -> bool:
            async with TestSession() as session:
                queued = await session.scalar(
                    text("SELECT count(*) FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted AND transactionid::text = :xid"),
                    {"xid": held_by},
                )
            return queued > 0

        yield holder, someone_is_waiting
        await holder.commit()


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
    assert results[0].detail in {_ALREADY_UNDER_WAY, "Your profile is not waiting to be deleted"}, "told it has begun or is over"
    assert await _stored_marks(user) is None
    assert await _accounts(user.id) == 0
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]


async def test_a_cancel_waits_for_the_lock_and_clears_the_mark_once_it_is_released(profile_deletions):
    """A cancel made while the user row is locked waits, and then cancels a deletion that is still ahead"""
    now = datetime.now(UTC)
    user = await _commit_user("waits@example.com", requested_at=now, due_at=now + timedelta(hours=1), with_account=True)

    async with _holding_the_user_row(user.id) as (_, someone_is_waiting):
        cancel = asyncio.create_task(_cancel(user.id))
        await _poll(someone_is_waiting, "the cancel never queued behind the lock")
        assert not cancel.done(), "the cancel is still waiting"
        assert await _stored_marks(user) is not None, "nothing is cleared while it waits"

    cancelled = await cancel

    assert cancelled.deletion_due_at is None
    assert await _stored_marks(user) == (None, None, None)
    assert await _accounts(user.id) == 1


async def test_a_cancel_that_waits_past_the_due_time_is_refused_and_the_profile_stays_marked(profile_deletions):
    """The due time is read once the lock is held, not when the cancel began, so a cancel the wait carried past it is too late"""
    now = datetime.now(UTC)
    due_at = now + timedelta(seconds=3)
    user = await _commit_user("late@example.com", requested_at=now, due_at=due_at, with_account=True)

    async with _holding_the_user_row(user.id) as (_, someone_is_waiting):
        cancel = asyncio.create_task(_cancel(user.id))
        await _poll(someone_is_waiting, "the cancel never queued behind the lock")
        assert not cancel.done(), "the cancel is still waiting"

        async def due_time_has_passed() -> bool:
            async with TestSession() as session:
                return await session.scalar(text("SELECT clock_timestamp() > :due"), {"due": due_at})

        await _poll(due_time_has_passed, "the due time never passed")
        assert not cancel.done(), "the cancel is still waiting after the due time"

    with pytest.raises(HTTPException) as refused:
        await cancel

    assert (refused.value.status_code, refused.value.detail) == (409, _ALREADY_UNDER_WAY)
    marks = await _stored_marks(user)
    assert marks[0] is not None and marks[1] == due_at, "the profile stays marked"
    assert await _accounts(user.id) == 1


async def test_a_run_waits_for_the_lock_and_deletes_nothing_when_the_mark_is_cleared_meanwhile(profile_deletions):
    """A run on a due profile queues behind a held lock, and once it is released finds the mark cleared by the holder and deletes nothing"""
    now = datetime.now(UTC)
    user = await _commit_user("cleared@example.com", requested_at=now - timedelta(days=7), due_at=now - timedelta(minutes=1), with_account=True)

    async def take_the_runs_lock() -> tuple[str, datetime | None] | None:
        """What the run's first step does, as a run would, and what it was answered"""
        async with _act_as(user.id) as db:
            return await removal._lock_due_user(db, user.id)

    async with _holding_the_user_row(user.id) as (holder, someone_is_waiting):
        locking = asyncio.create_task(take_the_runs_lock())
        await _poll(someone_is_waiting, "the run's lock never queued behind the held one")
        assert not locking.done(), "the run's lock is still waiting"
        await holder.execute(
            update(User).where(User.id == user.id).values(deletion_requested_at=None, deletion_due_at=None, deletion_reminder_sent_at=None)
        )
        assert not locking.done(), "it waits for the holder's commit"

    assert await locking is None, "once the holder has committed, the run finds no mark and nothing to delete"

    await delete_profile(ScopedSession, user.id)

    assert await _stored_marks(user) == (None, None, None)
    assert await _accounts(user.id) == 1
    assert profile_deletions == []


async def test_a_cancel_after_a_run_has_started_is_refused_and_the_profile_stays_marked_part_way(profile_deletions, monkeypatch):
    """Once the due time has passed and the first batch is gone, a cancel is refused, so no profile is unmarked while half of it is deleted"""
    now = datetime.now(UTC)
    user = await _commit_user("half@example.com", requested_at=now - timedelta(days=7), due_at=now - timedelta(minutes=1), with_account=True)
    first_step = next(step for step in removal._deletion_steps() if step[0] is Account.__table__)

    def stops_after_the_first_batch():
        yield first_step
        raise RuntimeError("The server restarted")

    monkeypatch.setattr(removal, "_deletion_steps", stops_after_the_first_batch)
    await delete_profile(ScopedSession, user.id)
    assert await _accounts(user.id) == 0, "the first batch is gone"
    assert await _stored_marks(user) is not None, "the run stopped part-way"

    with pytest.raises(HTTPException) as refused:
        await _cancel(user.id)

    assert (refused.value.status_code, refused.value.detail) == (409, _ALREADY_UNDER_WAY)
    marks = await _stored_marks(user)
    assert marks is not None and marks[0] is not None and marks[1] is not None, "the profile is still marked"
    assert profile_deletions == []
