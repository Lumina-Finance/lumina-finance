"""Profile deletion observer tests calling the hook directly, for what a route test cannot set up"""

import logging
import uuid
from datetime import UTC, datetime

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
