"""Concrete email senders and the configured selection"""

import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import (
    EMAIL_BACKEND,
    EMAIL_BACKEND_LOGGING,
    EMAIL_BACKEND_SMTP,
    MAIL_FROM,
    MAIL_FROM_NAME,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USE_TLS,
    SMTP_USERNAME,
)
from app.services.email.contract import EmailSender, RenderedEmail

logger = logging.getLogger(__name__)


class SmtpEmailSender:
    """Delivers email through an SMTP server for self-hosted deployments"""

    async def send(self, recipient: str, message: RenderedEmail) -> None:
        """Build a multipart message and deliver it over SMTP

        Args:
            recipient: Address receiving the message
            message: Rendered subject and bodies to deliver
        """
        email_message = EmailMessage()
        email_message["From"] = f"{MAIL_FROM_NAME} <{MAIL_FROM}>"
        email_message["To"] = recipient
        email_message["Subject"] = message.subject
        email_message.set_content(message.text_body)

        # A client that cannot render HTML falls back to the plain-text part set above
        if message.html_body is not None:
            email_message.add_alternative(message.html_body, subtype="html")

        await aiosmtplib.send(
            email_message,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USERNAME or None,
            password=SMTP_PASSWORD or None,
            start_tls=SMTP_USE_TLS,
        )


class LoggingEmailSender:
    """Logs email instead of delivering it, for development and tests"""

    async def send(self, recipient: str, message: RenderedEmail) -> None:
        """Log the message so a link such as a reset URL is readable from the server output

        Args:
            recipient: Address the message would be delivered to
            message: Rendered subject and bodies to log
        """
        # Logged at warning level so a missing real sender is visible in production too
        logger.warning(
            "Email not sent (logging backend)\nTo: %s\nSubject: %s\n\n%s",
            recipient,
            message.subject,
            message.text_body,
        )


def build_email_sender() -> EmailSender:
    """Build the sender named by EMAIL_BACKEND

    Raises:
        RuntimeError: EMAIL_BACKEND names an unknown backend
    """
    if EMAIL_BACKEND == EMAIL_BACKEND_SMTP:
        return SmtpEmailSender()
    if EMAIL_BACKEND == EMAIL_BACKEND_LOGGING:
        return LoggingEmailSender()

    raise RuntimeError(f"Unknown EMAIL_BACKEND {EMAIL_BACKEND!r}")
