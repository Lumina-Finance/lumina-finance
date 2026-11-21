"""Email change observer tests calling the hook directly, for what a route test cannot set up"""

import logging
import uuid

from app.email_change_hook import EmailChange, notify_email_change, observe_email_changes

_CHANGE = EmailChange(user_id=uuid.uuid4(), old_email="old.address@example.com", new_email="new.address@example.com")


def test_every_observer_gets_the_change(email_changes):
    """Observers added in turn each hear of the change, as they were added"""
    later: list[EmailChange] = []
    observe_email_changes(later.append)

    notify_email_change(_CHANGE)

    assert email_changes == [_CHANGE]
    assert later == [_CHANGE]


def test_an_observer_that_fails_does_not_stop_the_others_and_logs_no_address(email_changes, caplog):
    """A broken observer is logged by its class alone, even when its error quotes an address, and the observers after it still run"""

    def broken(change: EmailChange) -> None:
        raise ValueError(f"cannot reach {change.new_email}")

    observe_email_changes(broken)
    later: list[EmailChange] = []
    observe_email_changes(later.append)

    with caplog.at_level(logging.WARNING):
        notify_email_change(_CHANGE)

    assert later == [_CHANGE]
    assert "ValueError" in caplog.text
    assert _CHANGE.new_email not in caplog.text
    assert _CHANGE.old_email not in caplog.text
