"""Email service tests"""

import logging

import app.services.email as email_service
from app.services.email import _build_message, send_email


def test_build_message_sets_sender_recipient_and_body():
    """The message carries the configured sender plus the recipient, subject, and body"""
    message = _build_message("user@example.com", "Subject line", "Body text")

    assert message["To"] == "user@example.com"
    assert message["Subject"] == "Subject line"
    assert "Lumina Finance" in message["From"]
    assert message.get_content().strip() == "Body text"


async def test_send_email_logs_when_no_smtp_host(caplog):
    """A blank SMTP host logs the message instead of attempting delivery"""
    with caplog.at_level(logging.INFO):
        await send_email("user@example.com", "Hello", "Body text")

    assert any("Email suppressed" in record.message for record in caplog.records)


async def test_send_email_delivers_when_smtp_host_configured(monkeypatch):
    """A configured SMTP host delivers the built message through aiosmtplib"""
    sent = {}

    async def fake_send(message, **kwargs):
        sent["message"] = message
        sent["kwargs"] = kwargs

    monkeypatch.setattr(email_service, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(email_service.aiosmtplib, "send", fake_send)

    await send_email("user@example.com", "Subject line", "Body text")

    assert sent["message"]["To"] == "user@example.com"
    assert sent["kwargs"]["hostname"] == "smtp.example.com"
