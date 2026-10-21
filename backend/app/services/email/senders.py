"""Concrete email senders and the configured selection"""

import logging
from email.headerregistry import Address
from email.message import EmailMessage

import aiosmtplib

from app.config.email import (
    EMAIL_BACKEND,
    EMAIL_BACKEND_LOGGING,
    EMAIL_BACKEND_SMTP,
    EMAIL_SENDER_NAME,
    MAIL_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_TIMEOUT_SECONDS,
    SMTP_USE_TLS,
    SMTP_USERNAME,
)
from app.services.email.contract import EmailSender, RenderedEmail

logger = logging.getLogger(__name__)

# The port SMTP servers conventionally serve implicit TLS on
IMPLICIT_TLS_PORT = 465


class SmtpEmailSender:
    """Delivers email through an SMTP server for self-hosted deployments"""

    async def send(self, recipient: str, message: RenderedEmail) -> None:
        """Build a multipart message and deliver it over SMTP

        Args:
            recipient: Address receiving the message
            message: Rendered subject and bodies to deliver
        """
        email_message = EmailMessage()

        # Address quotes the display name so the parenthesised suffix is not parsed as a comment
        email_message["From"] = Address(display_name=EMAIL_SENDER_NAME, addr_spec=MAIL_FROM)
        email_message["To"] = recipient
        email_message["Subject"] = message.subject
        email_message.set_content(message.text_body)

        # A client that cannot render HTML falls back to the plain-text part set above
        if message.html_body is not None:
            email_message.add_alternative(message.html_body, subtype="html")

        # Port 465 is the implicit TLS port, but some servers there speak STARTTLS, so a connect or
        # TLS failure retries once with STARTTLS required. A server that connected and then refused
        # the login or an address is not retried, and plain text is never an option when TLS is on
        if SMTP_USE_TLS and SMTP_PORT == IMPLICIT_TLS_PORT:
            try:
                await self._deliver(email_message, use_tls=True, start_tls=False)
            except aiosmtplib.SMTPConnectError:
                logger.info("Implicit TLS to the mail server failed, retrying with STARTTLS", exc_info=True)
                await self._deliver(email_message, use_tls=False, start_tls=True)
            return

        await self._deliver(email_message, use_tls=False, start_tls=SMTP_USE_TLS)

    async def _deliver(self, email_message: EmailMessage, *, use_tls: bool, start_tls: bool) -> None:
        """Make one delivery attempt with the given TLS mode, bounded by the SMTP timeout"""
        await aiosmtplib.send(
            email_message,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USERNAME or None,
            password=SMTP_PASSWORD or None,
            use_tls=use_tls,
            start_tls=start_tls,
            timeout=SMTP_TIMEOUT_SECONDS,
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
