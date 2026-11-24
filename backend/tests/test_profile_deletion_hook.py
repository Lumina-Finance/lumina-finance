"""Profile deletion observer tests calling the hook directly, for what a route test cannot set up"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

import pytest

import app.profile_deletion_hook as profile_deletion_hook
from app.profile_deletion_hook import ProfileDeletion, notify_profile_deletion, observe_profile_deletions

_DELETION = ProfileDeletion(user_id=uuid.uuid4(), deleted_at=datetime(2026, 11, 23, tzinfo=UTC))


def test_notify_with_a_failing_observer_still_reaches_the_observers_after_it(profile_deletions, caplog):
    """One broken observer does not keep the observers added after it from hearing of the deletion, and only its error's class is logged"""

    def broken(deletion: ProfileDeletion) -> None:
        raise ValueError(f"cannot reach {deletion.user_id}")

    observe_profile_deletions(broken)
    later: list[ProfileDeletion] = []
    observe_profile_deletions(later.append)

    with caplog.at_level(logging.WARNING, logger="app.profile_deletion_hook"):
        notify_profile_deletion(_DELETION)

    assert profile_deletions == [_DELETION]
    assert later == [_DELETION]
    assert "ValueError" in caplog.text
    assert str(_DELETION.user_id) not in caplog.text


def test_the_wait_is_none_until_set_and_a_set_wait_is_read_back(profile_deletion_wait):
    """Deletions are immediate by default, and a set wait is the one read"""
    assert profile_deletion_hook.profile_deletion_wait() == timedelta(0)

    profile_deletion_wait(timedelta(days=7))

    assert profile_deletion_hook.profile_deletion_wait() == timedelta(days=7)


def test_a_negative_wait_is_refused_and_keeps_the_wait_before_it(profile_deletion_wait):
    """A wait before now would put the due time in the past, so it is refused and the earlier wait stays"""
    profile_deletion_wait(timedelta(days=2))

    with pytest.raises(ValueError, match="negative"):
        profile_deletion_wait(timedelta(seconds=-1))

    assert profile_deletion_hook.profile_deletion_wait() == timedelta(days=2)


def test_a_wait_that_is_not_a_timedelta_is_refused(profile_deletion_wait):
    """A bare number could mean seconds or days, so only a timedelta is taken"""
    with pytest.raises(TypeError):
        profile_deletion_wait(7)
