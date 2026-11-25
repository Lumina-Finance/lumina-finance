"""The emails about a waiting profile deletion, each sent best effort

A sender that isn't installed, or one that fails, never fails the request or the cleanup pass that sends
the email, since the deletion's own steps matter more than the notice of them
"""

import logging
from collections.abc import Callable
from datetime import datetime

from app.services.email import (
    RenderedEmail,
    get_email_sender,
    render_profile_deletion_done_email,
    render_profile_deletion_reminder_email,
    render_profile_deletion_scheduled_email,
)

logger = logging.getLogger(__name__)


async def send_scheduled_email(recipient: str, due_at: datetime, tz: str | None = None) -> None:
    """Tell a user the date their profile will be deleted and that signing in before it cancels

    Args:
        recipient: The user's email address
        due_at: When the deletion is due
        tz: The user's IANA timezone, whose calendar gives the date
    """
    await _send(recipient, lambda: render_profile_deletion_scheduled_email(due_at, tz), "scheduled")


async def send_reminder_email(recipient: str, due_at: datetime, tz: str | None = None) -> None:
    """Remind a user that their profile will be deleted within days

    Args:
        recipient: The user's email address
        due_at: When the deletion is due
        tz: The user's IANA timezone, whose calendar gives the date
    """
    await _send(recipient, lambda: render_profile_deletion_reminder_email(due_at, tz), "reminder")


async def send_done_email(recipient: str) -> None:
    """Tell a user their profile has been deleted

    Args:
        recipient: The address the user had, read before the user row went
    """
    await _send(recipient, render_profile_deletion_done_email, "done")


async def _send(recipient: str, render: Callable[[], RenderedEmail], kind: str) -> None:
    """Render and send one message, logging a failure by the class of its error and carrying on"""
    try:
        await get_email_sender().send(recipient, render())
    except Exception as error:
        # Best-effort boundary: the deletion's steps don't depend on the notice. Only the class is logged,
        # since the mail library's error text can quote an address
        logger.warning("The profile deletion %s email failed to send: %s", kind, type(error).__name__)
