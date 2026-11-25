"""The deletion run with a waiting period: left alone until due, then the done email once the profile is gone"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.models.auth_session import AuthSession
from app.services.email import contract as email_contract
from app.services.profile_deletion import delete_marked_profiles, delete_profile
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.profile_deletion_helpers import _commit_user, _stored_marks


async def test_a_profile_still_waiting_is_left_alone_by_the_run_and_the_cleanup(sent_action_emails, profile_deletions):
    """Neither the request's run nor the cleanup touches a profile whose due time is ahead, its sessions, data or owner's inbox"""
    now = datetime.now(UTC)
    user = await _commit_user("waiting@example.com", requested_at=now, due_at=now + timedelta(hours=1), with_account=True)
    async with TestSession() as session:
        session.add(AuthSession(user_id=user.id, expires_at=now + timedelta(days=1)))
        await session.commit()

    await delete_profile(ScopedSession, user.id)
    await delete_marked_profiles(ScopedSession)

    assert await _stored_marks(user) is not None
    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.user_id == user.id)) == 1, (
            "the session stays"
        )
    assert profile_deletions == []
    assert sent_action_emails == []


async def test_a_profile_that_had_a_due_time_sends_the_done_email_to_the_address_it_had(sent_action_emails, profile_deletions):
    """Once the data and the user row are gone the owner is emailed at the address read before the row went"""
    now = datetime.now(UTC)
    user = await _commit_user("gone@example.com", requested_at=now - timedelta(days=7), due_at=now - timedelta(minutes=1), with_account=True)

    await delete_marked_profiles(ScopedSession)

    assert await _stored_marks(user) is None
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]
    assert [(recipient, message.subject) for recipient, message in sent_action_emails] == [("gone@example.com", "Your profile was deleted")]


async def test_a_mark_with_no_due_time_deletes_at_once_and_sends_no_done_email(sent_action_emails, profile_deletions):
    """A profile marked before waiting existed has no due time, so the run starts and no email follows"""
    user = await _commit_user("immediate@example.com", requested_at=datetime.now(UTC) - timedelta(minutes=5), with_account=True)

    await delete_marked_profiles(ScopedSession)

    assert await _stored_marks(user) is None
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]
    assert sent_action_emails == []


@pytest.mark.parametrize("sender", ["raises", "missing"])
async def test_a_done_email_that_cannot_be_sent_stops_nothing(monkeypatch, profile_deletions, sender):
    """The profile is gone and the observers have heard when the sender fails or isn't installed"""

    async def fail(recipient, message):
        raise ConnectionError("cannot reach the mail server")

    monkeypatch.setattr(email_contract, "_active_sender", SimpleNamespace(send=fail) if sender == "raises" else None)
    now = datetime.now(UTC)
    user = await _commit_user("gone@example.com", requested_at=now - timedelta(days=7), due_at=now - timedelta(minutes=1), with_account=True)

    await delete_marked_profiles(ScopedSession)

    assert await _stored_marks(user) is None
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]
