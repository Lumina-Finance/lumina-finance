"""Reminding the owners of waiting profile deletions, once each and only when the date is close"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.rls.functions import LIST_PROFILES_TO_REMIND
from app.models.user import User
from app.services.email import contract as email_contract
from app.services.profile_deletion import send_due_reminders
from tests.conftest import ScopedSession
from tests.routes.support.identity_helpers import _act_as
from tests.routes.support.profile_deletion_helpers import _commit_user, _stored_marks


async def _seed_each_stage() -> dict[str, User]:
    """Commit a user at each stage a profile deletion can be in, keyed by the stage"""
    now = datetime.now(UTC)
    return {
        "due soon": await _commit_user("soon@example.com", requested_at=now - timedelta(days=8), due_at=now + timedelta(days=2)),
        "far off": await _commit_user("far@example.com", requested_at=now - timedelta(days=1), due_at=now + timedelta(days=6)),
        "short wait": await _commit_user("short@example.com", requested_at=now - timedelta(hours=12), due_at=now + timedelta(days=2)),
        "already reminded": await _commit_user(
            "reminded@example.com",
            requested_at=now - timedelta(days=8),
            due_at=now + timedelta(days=2),
            reminder_sent_at=now - timedelta(hours=1),
        ),
        "past due": await _commit_user("past@example.com", requested_at=now - timedelta(days=9), due_at=now - timedelta(hours=1)),
        "no due time": await _commit_user("immediate@example.com", requested_at=now - timedelta(days=9)),
        "never asked": await _commit_user("never@example.com"),
    }


async def test_only_a_waiting_profile_due_within_three_days_and_asked_longer_ago_is_reminded(sent_action_emails):
    """Each stage but the one due soon is skipped, and the reminder names the date and the days left"""
    users = await _seed_each_stage()
    due_at = (await _stored_marks(users["due soon"]))[1]

    await send_due_reminders(ScopedSession)

    assert [(recipient, message.subject) for recipient, message in sent_action_emails] == [
        ("soon@example.com", "Your profile will be deleted in 3 days or less")
    ]
    body = sent_action_emails[0][1].text_body
    assert f"{due_at.day} {due_at:%B %Y}" in body, "the reminder names the date"
    assert "Please sign in before then to cancel" in body
    assert (await _stored_marks(users["due soon"]))[2] is not None, "the reminder is recorded as sent"
    for stage in ("far off", "short wait", "past due", "no due time", "never asked"):
        assert (await _stored_marks(users[stage]))[2] is None, f"{stage} is left unreminded"


async def test_a_reminder_goes_once_however_many_passes_run(sent_action_emails):
    """A second pass finds the profile already reminded, so the owner gets one email"""
    now = datetime.now(UTC)
    await _commit_user("soon@example.com", requested_at=now - timedelta(days=8), due_at=now + timedelta(days=2))

    await send_due_reminders(ScopedSession)
    await send_due_reminders(ScopedSession)

    assert [recipient for recipient, _ in sent_action_emails] == ["soon@example.com"]


@pytest.mark.parametrize("sender", ["raises", "missing"])
async def test_a_reminder_that_cannot_be_sent_is_not_sent_again_and_stops_nothing(monkeypatch, sender):
    """A failing or missing sender leaves the reminder recorded, the pass answering, and the next profile reminded as far as it can"""
    now = datetime.now(UTC)
    users = [
        await _commit_user(f"soon{index}@example.com", requested_at=now - timedelta(days=8), due_at=now + timedelta(days=2))
        for index in range(2)
    ]

    async def fail(recipient, message):
        raise ConnectionError("cannot reach the mail server")

    monkeypatch.setattr(email_contract, "_active_sender", SimpleNamespace(send=fail) if sender == "raises" else None)

    await send_due_reminders(ScopedSession)

    for user in users:
        assert (await _stored_marks(user))[2] is not None


async def test_listing_the_profiles_to_remind_is_refused_under_a_user_identity():
    """Only the cleanup, with no request identity, may see which users are waiting to be deleted"""
    user = await _commit_user("asker@example.com")

    async with _act_as(user.id) as session:
        with pytest.raises(DBAPIError, match="Only the cleanup may list the profiles to remind"):
            await session.execute(text(f"SELECT {LIST_PROFILES_TO_REMIND}()"))
