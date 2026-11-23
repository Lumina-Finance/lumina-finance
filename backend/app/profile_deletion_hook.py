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
from datetime import datetime

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
