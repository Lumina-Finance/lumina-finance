"""Email capture for route tests"""

import re
from dataclasses import dataclass

from app.services.email import RenderedEmail

_CONFIRM_LINK_PATTERN = re.compile(r"/confirm-email\?token=(\S+)")


@dataclass(frozen=True)
class SentEmail:
    """An email the app handed to its sender"""

    recipient: str
    message: RenderedEmail


class CapturingEmailSender:
    """Keeps every email in memory instead of delivering it"""

    def __init__(self) -> None:
        """Start with an empty mailbox"""
        self.sent: list[SentEmail] = []

    async def send(self, recipient: str, message: RenderedEmail) -> None:
        """Record the email"""
        self.sent.append(SentEmail(recipient, message))

    def sent_to(self, recipient: str) -> list[SentEmail]:
        """Return the emails sent to one address, oldest first, ignoring case as mail delivery does"""
        wanted = recipient.lower()
        return [email for email in self.sent if email.recipient.lower() == wanted]

    def confirmation_token(self, recipient: str) -> str:
        """Return the token in the latest confirmation link sent to the address

        Raises:
            AssertionError: No confirmation link was sent to the address
        """
        for email in reversed(self.sent_to(recipient)):
            match = _CONFIRM_LINK_PATTERN.search(email.message.text_body)
            if match:
                return match.group(1)
        raise AssertionError(f"No confirmation link was sent to {recipient}")


# The one sender route tests install, emptied before each test
mailbox = CapturingEmailSender()
