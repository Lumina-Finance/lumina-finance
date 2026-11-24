"""A place for code that acts when a user's profile is deleted to plug in

Code registers an observer with observe_profile_deletions. Once a profile and everything it held are
gone, each observer is called with a ProfileDeletion, at most once per profile. The call follows the
commit in the same process, so a restart between the two loses it, and an observer that must never
miss one also checks for users it knows that no longer exist
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProfileDeletion:
    """What an observer is told about a deleted profile

    Attributes:
        user_id: The user whose profile was deleted. No row in the app has this id any more
        deleted_at: When the user row was deleted
    """

    user_id: uuid.UUID
    deleted_at: datetime


ProfileDeletionObserver = Callable[[ProfileDeletion], None]

_observers: list[ProfileDeletionObserver] = []


def observe_profile_deletions(observer: ProfileDeletionObserver) -> None:
    """Call the observer every time a user's profile is deleted

    Args:
        observer: Function taking the deletion. It runs in the app after the deletion commits, so it
            must return quickly, and an error it raises is logged by its class and stops nothing else
    """
    _observers.append(observer)


def notify_profile_deletion(deletion: ProfileDeletion) -> None:
    """Tell every observer about a deleted profile, whatever one of them does

    Args:
        deletion: The deletion that was just committed
    """
    for observer in tuple(_observers):
        try:
            observer(deletion)
        except Exception as error:
            # Best-effort boundary: the profile is already gone, so one observer failing must neither undo
            # the deletion nor keep the others from hearing of it. Only the class is logged, in step with
            # the email change observers
            logger.warning("A profile deletion observer failed: %s", type(error).__name__)


# How long a deleted profile waits before its data goes. No wait deletes at once. It is set in code and
# never read from the environment, and a change applies to requests made after it
_wait = timedelta(0)


def set_profile_deletion_wait(wait: timedelta) -> None:
    """Make a profile deletion wait before it removes anything, so its owner can still cancel it

    With a wait set, confirming the deletion marks the profile and signs the user out everywhere. The
    user can sign in again until the end of the wait, only to cancel, and the data goes once it has
    passed. A wait changed later applies only to requests made after the change

    Args:
        wait: How long the deletion waits. No time at all, the default, deletes at once

    Raises:
        TypeError: The value is not a timedelta
        ValueError: The wait is negative
    """
    global _wait
    if not isinstance(wait, timedelta):
        raise TypeError("set_profile_deletion_wait takes a timedelta")
    if wait < timedelta(0):
        raise ValueError("A profile deletion cannot wait a negative time")
    _wait = wait


def profile_deletion_wait() -> timedelta:
    """Return how long a profile deletion waits, no time at all unless code has set one"""
    return _wait
