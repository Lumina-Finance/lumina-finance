"""Email sender tests"""

import asyncio
import logging

import aiosmtplib
import pytest

import app.services.email.contract as contract_module
import app.services.email.senders as senders_module
from app.services.email import RenderedEmail, build_email_sender, get_email_sender, render_reset_email, set_email_sender
from app.services.email.senders import LoggingEmailSender, SmtpEmailSender


async def test_smtp_sender_delivers_multipart_message(monkeypatch):
    """The SMTP sender delivers the subject, recipient, and both body parts"""
    sent = {}

    async def fake_send(email_message, **kwargs):
        sent["message"] = email_message
        sent["kwargs"] = kwargs

    monkeypatch.setattr(senders_module, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(senders_module, "MAIL_FROM", "no-reply@example.com")
    monkeypatch.setattr(senders_module.aiosmtplib, "send", fake_send)

    message = RenderedEmail(subject="Subject line", text_body="Body text", html_body="<p>Body text</p>")
    await SmtpEmailSender().send("user@example.com", message)

    delivered = sent["message"]
    assert delivered["To"] == "user@example.com"
    assert delivered["Subject"] == "Subject line"
    assert sent["kwargs"]["hostname"] == "smtp.example.com"

    # The fixed sender name marks mail from a self-hosted instance
    assert "Lumina Finance (Self-Hosted)" in delivered["From"]

    # The HTML alternative rides alongside the plain-text part
    assert delivered.get_content_type() == "multipart/alternative"


async def test_smtp_sender_times_out_on_a_silent_server(monkeypatch):
    """A server that accepts the connection and never greets fails the send within the SMTP timeout"""

    # Closes its side once the client gives up, so leaving the server never waits on an open connection
    async def hold_connection_silently(reader, writer):
        await reader.read()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(hold_connection_silently, "127.0.0.1", 0)
    monkeypatch.setattr(senders_module, "SMTP_HOST", "127.0.0.1")
    monkeypatch.setattr(senders_module, "SMTP_PORT", server.sockets[0].getsockname()[1])
    monkeypatch.setattr(senders_module, "MAIL_FROM", "no-reply@example.com")
    monkeypatch.setattr(senders_module, "SMTP_TIMEOUT_SECONDS", 0.2)

    # The outer bound only keeps a missing timeout from stalling the suite for the library's own minute
    async with server:
        with pytest.raises(aiosmtplib.SMTPTimeoutError):
            await asyncio.wait_for(SmtpEmailSender().send("user@example.com", RenderedEmail(subject="Hi", text_body="Body")), 5)


async def test_logging_sender_logs_body(caplog):
    """The logging sender records the text body instead of delivering it"""
    message = RenderedEmail(subject="Hello", text_body="Body text")
    with caplog.at_level(logging.WARNING):
        await LoggingEmailSender().send("user@example.com", message)

    logged = [record.getMessage() for record in caplog.records]
    assert any("Body text" in entry for entry in logged)


def test_build_email_sender_selects_backend(monkeypatch):
    """EMAIL_BACKEND chooses the sender and an unknown value fails loudly"""
    monkeypatch.setattr(senders_module, "EMAIL_BACKEND", "smtp")
    assert isinstance(build_email_sender(), SmtpEmailSender)

    monkeypatch.setattr(senders_module, "EMAIL_BACKEND", "logging")
    assert isinstance(build_email_sender(), LoggingEmailSender)

    monkeypatch.setattr(senders_module, "EMAIL_BACKEND", "nope")
    with pytest.raises(RuntimeError):
        build_email_sender()


def test_get_email_sender_requires_installation(monkeypatch):
    """get_email_sender fails when nothing is installed and returns the installed sender"""
    monkeypatch.setattr(contract_module, "_active_sender", None)
    with pytest.raises(RuntimeError):
        get_email_sender()

    sender = LoggingEmailSender()
    set_email_sender(sender)
    assert get_email_sender() is sender


def test_render_reset_email_carries_link_in_both_parts():
    """The rendered reset email includes the link and expiry in the HTML and text parts"""
    message = render_reset_email("https://app.example.com/reset-password?token=abc123", 15)

    assert message.subject
    assert "abc123" in message.text_body
    assert "abc123" in message.html_body
    assert "15" in message.text_body
    assert "15" in message.html_body
