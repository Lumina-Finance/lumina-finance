"""Email sending service"""

import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import (
    MAIL_FROM,
    MAIL_FROM_NAME,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USE_TLS,
    SMTP_USERNAME,
)

logger = logging.getLogger(__name__)


def _build_message(recipient: str, subject: str, body: str) -> EmailMessage:
    """Build a plain-text message addressed from the configured sender"""
    message = EmailMessage()
    message["From"] = f"{MAIL_FROM_NAME} <{MAIL_FROM}>"
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    return message


async def send_email(recipient: str, subject: str, body: str) -> None:
    """Send a plain-text email, or log it when no SMTP host is configured

    Development and tests leave SMTP_HOST blank, so the message is logged instead of
    delivered to keep those environments self-contained with no mail server
    """
    message = _build_message(recipient, subject, body)

    if not SMTP_HOST:
        logger.info("Email suppressed, no SMTP host configured, to=%s subject=%s", recipient, subject)
        return

    await aiosmtplib.send(
        message,
        hostname=SMTP_HOST,
        port=SMTP_PORT,
        username=SMTP_USERNAME or None,
        password=SMTP_PASSWORD or None,
        start_tls=SMTP_USE_TLS,
    )
