"""Email contract and the active-sender slot"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RenderedEmail:
    """A fully rendered email any sender can deliver

    The html_body is optional so text-only messages carry no HTML alternative
    """

    subject: str
    text_body: str
    html_body: str | None = None


class EmailSender(Protocol):
    """Delivers a rendered email to a single recipient"""

    async def send(self, recipient: str, message: RenderedEmail) -> None:
        """Deliver the message to the recipient"""
        ...


# A sender installed here at startup handles every outgoing message
_active_sender: EmailSender | None = None


def set_email_sender(sender: EmailSender) -> None:
    """Install the active email sender"""
    global _active_sender
    _active_sender = sender


def get_email_sender() -> EmailSender:
    """Return the installed email sender

    Raises:
        RuntimeError: No sender has been installed
    """
    if _active_sender is None:
        raise RuntimeError("No email sender installed")
    return _active_sender
