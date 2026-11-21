"""A place for code that acts when an account's email address changes to plug in

Code registers an observer with observe_email_changes. Once a change is confirmed and saved, each
observer is called with an EmailChange. The change holds both addresses, so an observer must never
write it whole to a log
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailChange:
    """What an observer is told about a confirmed email change

    Attributes:
        user_id: Account whose address changed
        old_email: Address the account had, as it was stored
        new_email: Address the account has now, as it is stored
    """

    user_id: uuid.UUID
    old_email: str
    new_email: str


EmailChangeObserver = Callable[[EmailChange], None]

_observers: list[EmailChangeObserver] = []


def observe_email_changes(observer: EmailChangeObserver) -> None:
    """Call the observer with the change every time an account's email address changes

    Args:
        observer: Function taking the change. It runs on the request that confirmed the change, so it
            must return quickly, and an error it raises is logged by its class and does not reach the request
    """
    _observers.append(observer)


def notify_email_change(change: EmailChange) -> None:
    """Tell every observer about a saved change, whatever one of them does

    Args:
        change: The change that was just committed
    """
    for observer in tuple(_observers):
        try:
            observer(change)
        except Exception as error:
            # Best-effort boundary: the change is already saved, so one observer failing must neither fail
            # the request nor keep the others from hearing of it. Only the class is logged, since the
            # error text may quote an address
            logger.warning("An email change observer failed: %s", type(error).__name__)
