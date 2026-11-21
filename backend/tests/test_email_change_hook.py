"""Email change observer tests calling the hook directly, for what a route test cannot set up"""

import uuid

from app.email_change_hook import EmailChange, notify_email_change, observe_email_changes

_CHANGE = EmailChange(user_id=uuid.uuid4(), old_email="old.address@example.com", new_email="new.address@example.com")


def test_notify_with_a_failing_observer_still_reaches_the_observers_after_it(email_changes):
    """One broken observer does not keep the observers added after it from hearing of the change"""

    def broken(change: EmailChange) -> None:
        raise ValueError(f"cannot reach {change.new_email}")

    observe_email_changes(broken)
    later: list[EmailChange] = []
    observe_email_changes(later.append)

    notify_email_change(_CHANGE)

    assert email_changes == [_CHANGE]
    assert later == [_CHANGE]
