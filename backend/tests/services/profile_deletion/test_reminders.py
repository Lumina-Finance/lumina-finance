"""Reminding the owners of waiting profile deletions, once each and only when the date is close"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.config.profile_deletion import DELETION_REMINDER_LEAD as _LEAD
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
    due_day = due_at.astimezone(ZoneInfo("America/Toronto"))
    assert f"{due_day.day} {due_day:%B %Y}" in body, "the reminder names the date in the profile's zone"
    assert "Please sign in and cancel before then." in body
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


@pytest.mark.parametrize(
    ("due_in", "wait", "reminded"),
    [
        (_LEAD - timedelta(minutes=1), timedelta(days=8), True),
        (_LEAD + timedelta(minutes=1), timedelta(days=8), False),
        (timedelta(days=2), _LEAD + timedelta(minutes=1), True),
        (timedelta(days=2), _LEAD - timedelta(minutes=1), False),
    ],
    ids=["due just inside the lead", "due just outside the lead", "wait just over the lead", "wait just under the lead"],
)
async def test_the_edges_of_the_lead_decide_who_is_reminded(sent_action_emails, due_in, wait, reminded):
    """A due time within the lead and a wait longer than it are both needed, and a minute either side of each decides"""
    now = datetime.now(UTC)
    due_at = now + due_in
    user = await _commit_user("edge@example.com", requested_at=due_at - wait, due_at=due_at)

    await send_due_reminders(ScopedSession)

    assert [recipient for recipient, _ in sent_action_emails] == (["edge@example.com"] if reminded else [])
    assert ((await _stored_marks(user))[2] is not None) is reminded


async def test_the_reminder_names_the_date_in_the_profile_zone(sent_action_emails):
    """A due time at 03:00 UTC is still the evening before in Toronto, so the reminder names that day, not the UTC one"""
    now = datetime.now(UTC)
    # The next 03:00 UTC at least an hour ahead, so the due time is still ahead when the pass claims it
    due_at = now.replace(hour=3, minute=0, second=0, microsecond=0)
    if due_at < now + timedelta(hours=1):
        due_at += timedelta(days=1)
    await _commit_user("zone@example.com", requested_at=due_at - timedelta(days=10), due_at=due_at)
    local_day = due_at - timedelta(days=1)

    await send_due_reminders(ScopedSession)

    assert [recipient for recipient, _ in sent_action_emails] == ["zone@example.com"]
    assert f"will be deleted on {local_day.day} {local_day:%B %Y}" in sent_action_emails[0][1].text_body


async def test_a_due_time_with_no_mark_is_not_reminded(sent_action_emails):
    """A row carrying a due time but no mark is not a waiting deletion, so its owner is left alone"""
    now = datetime.now(UTC)
    user = await _commit_user("unmarked@example.com", due_at=now + timedelta(days=2))

    await send_due_reminders(ScopedSession)

    assert sent_action_emails == []
    assert (await _stored_marks(user))[2] is None


@pytest.mark.parametrize("sender", ["raises", "missing"])
async def test_a_reminder_that_cannot_be_sent_is_recorded_once_and_the_pass_still_reminds_the_rest(monkeypatch, sender):
    """A failing sender is tried for every profile and then not again, and a missing one still leaves each reminder recorded"""
    now = datetime.now(UTC)
    users = [
        await _commit_user(f"soon{index}@example.com", requested_at=now - timedelta(days=8), due_at=now + timedelta(days=2))
        for index in range(2)
    ]
    attempts: list[str] = []

    async def fail(recipient, message):
        attempts.append(recipient)
        raise ConnectionError("cannot reach the mail server")

    monkeypatch.setattr(email_contract, "_active_sender", SimpleNamespace(send=fail) if sender == "raises" else None)
    expected_attempts = 2 if sender == "raises" else 0

    await send_due_reminders(ScopedSession)
    assert len(attempts) == expected_attempts, "the first profile's failure didn't stop the second from being tried"
    for user in users:
        assert (await _stored_marks(user))[2] is not None

    await send_due_reminders(ScopedSession)
    assert len(attempts) == expected_attempts, "a recorded reminder is not tried again"


async def test_listing_the_profiles_to_remind_is_refused_under_a_user_identity():
    """Only the cleanup, with no request identity, may see which users are waiting to be deleted"""
    user = await _commit_user("asker@example.com")

    async with _act_as(user.id) as session:
        with pytest.raises(DBAPIError, match="Only the cleanup may list the profiles to remind"):
            await session.execute(text(f"SELECT {LIST_PROFILES_TO_REMIND}()"))
