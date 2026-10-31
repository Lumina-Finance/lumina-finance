"""Email sender tests"""

import asyncio
import contextlib
import ipaddress
import logging
import ssl
import time
from datetime import UTC, datetime, timedelta

import aiosmtplib
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

import app.services.email.contract as contract_module
import app.services.email.senders as senders_module
from app.services.email import (
    RenderedEmail,
    build_email_sender,
    get_email_sender,
    render_reset_email,
    render_signup_confirmation_email,
    set_email_sender,
)
from app.services.email.senders import LoggingEmailSender, SmtpEmailSender

# A short SMTP timeout keeps the silent-server test fast while the bound it checks scales with the timeout
SILENT_SERVER_TEST_TIMEOUT_SECONDS = 1


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


def record_smtp_attempts(monkeypatch, outcomes):
    """Replace aiosmtplib.send with a stand-in that records each attempt's TLS options and raises or returns the next outcome"""
    attempts = []

    async def fake_send(email_message, **kwargs):
        attempts.append({"use_tls": kwargs.get("use_tls", False), "start_tls": kwargs["start_tls"], "timeout": kwargs["timeout"]})
        outcome = outcomes[len(attempts) - 1]
        if outcome is not None:
            raise outcome

    monkeypatch.setattr(senders_module, "MAIL_FROM", "no-reply@example.com")
    monkeypatch.setattr(senders_module.aiosmtplib, "send", fake_send)
    return attempts


async def send_test_email():
    """Send a minimal message through the SMTP sender"""
    await SmtpEmailSender().send("user@example.com", RenderedEmail(subject="Hi", text_body="Body"))


async def test_smtp_sender_tries_implicit_tls_first_on_port_465(monkeypatch):
    """Port 465 connects with implicit TLS and stops there when the server accepts it"""
    monkeypatch.setattr(senders_module, "SMTP_PORT", 465)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", True)
    attempts = record_smtp_attempts(monkeypatch, [None])

    await send_test_email()

    assert attempts == [{"use_tls": True, "start_tls": False, "timeout": senders_module.SMTP_TIMEOUT_SECONDS}]


@pytest.mark.parametrize(
    "failure",
    [
        aiosmtplib.SMTPConnectError("TLS handshake failed"),
        aiosmtplib.SMTPConnectTimeoutError("Timed out connecting"),
    ],
)
async def test_smtp_sender_retries_with_required_starttls_after_a_connect_failure_on_port_465(monkeypatch, failure):
    """A TLS or connect failure on port 465 retries once with STARTTLS required and a fresh timeout, never plain text"""
    monkeypatch.setattr(senders_module, "SMTP_PORT", 465)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", True)
    attempts = record_smtp_attempts(monkeypatch, [failure, None])

    await send_test_email()

    timeout = senders_module.SMTP_TIMEOUT_SECONDS
    assert attempts == [
        {"use_tls": True, "start_tls": False, "timeout": timeout},
        {"use_tls": False, "start_tls": True, "timeout": timeout},
    ]


async def test_smtp_sender_fails_when_port_465_offers_neither_kind_of_tls(monkeypatch):
    """A server that refuses implicit TLS and offers no STARTTLS fails the send with the STARTTLS error"""
    monkeypatch.setattr(senders_module, "SMTP_PORT", 465)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", True)
    no_starttls = aiosmtplib.SMTPException("SMTP STARTTLS extension not supported by server.")
    attempts = record_smtp_attempts(monkeypatch, [aiosmtplib.SMTPConnectError("TLS handshake failed"), no_starttls])

    with pytest.raises(aiosmtplib.SMTPException, match="STARTTLS"):
        await send_test_email()

    assert [(a["use_tls"], a["start_tls"]) for a in attempts] == [(True, False), (False, True)]


@pytest.mark.parametrize(
    "failure",
    [
        aiosmtplib.SMTPAuthenticationError(535, "Bad credentials"),
        aiosmtplib.SMTPRecipientsRefused([]),
        aiosmtplib.SMTPSenderRefused(550, "Sender refused", "no-reply@example.com"),
    ],
)
async def test_smtp_sender_does_not_retry_when_a_connected_server_refuses_the_message(monkeypatch, failure):
    """An authentication or address error from a server that accepted implicit TLS surfaces without a second attempt"""
    monkeypatch.setattr(senders_module, "SMTP_PORT", 465)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", True)
    attempts = record_smtp_attempts(monkeypatch, [failure, None])

    with pytest.raises(type(failure)):
        await send_test_email()

    assert len(attempts) == 1


async def test_smtp_sender_keeps_starttls_on_other_ports(monkeypatch):
    """Port 587 requires STARTTLS on a single attempt, and a connect failure there is not retried"""
    monkeypatch.setattr(senders_module, "SMTP_PORT", 587)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", True)
    attempts = record_smtp_attempts(monkeypatch, [aiosmtplib.SMTPConnectError("down"), None])

    with pytest.raises(aiosmtplib.SMTPConnectError):
        await send_test_email()

    assert attempts == [{"use_tls": False, "start_tls": True, "timeout": senders_module.SMTP_TIMEOUT_SECONDS}]


@pytest.mark.parametrize("port", [25, 465, 587])
async def test_smtp_sender_sends_in_plain_text_only_when_tls_is_off(monkeypatch, port):
    """SMTP_USE_TLS=false sends once without any TLS on every port, 465 included"""
    monkeypatch.setattr(senders_module, "SMTP_PORT", port)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", False)
    attempts = record_smtp_attempts(monkeypatch, [None])

    await send_test_email()

    assert [(a["use_tls"], a["start_tls"]) for a in attempts] == [(False, False)]


async def test_smtp_sender_never_attempts_plain_text_when_tls_is_wanted(monkeypatch):
    """Whatever fails on port 465, every attempt asks for implicit TLS or required STARTTLS"""
    monkeypatch.setattr(senders_module, "SMTP_PORT", 465)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", True)
    attempts = record_smtp_attempts(monkeypatch, [aiosmtplib.SMTPConnectError("down")] * 2)

    with pytest.raises(aiosmtplib.SMTPConnectError):
        await send_test_email()

    assert attempts
    assert all(a["use_tls"] or a["start_tls"] for a in attempts)


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


def create_loopback_certificate(directory):
    """Write a self-signed certificate valid for 127.0.0.1 and its key into the folder, returning both paths"""
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(hours=1))
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
        .sign(key, hashes.SHA256())
    )
    certificate_path = directory / "certificate.pem"
    key_path = directory / "key.pem"
    certificate_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return certificate_path, key_path


async def test_smtp_sender_stays_within_two_timeouts_when_a_tls_server_on_port_465_never_greets(monkeypatch, tmp_path):
    """A server that completes the TLS handshake and never greets fails the send within the retry's two timeouts"""
    certificate_path, key_path = create_loopback_certificate(tmp_path)
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(certificate_path, key_path)
    client_context = ssl.create_default_context(cafile=certificate_path)

    # Closes its side once the client gives up, so leaving the server never waits on an open connection
    async def hold_connection_silently(reader, writer):
        with contextlib.suppress(ssl.SSLError, ConnectionError):
            await reader.read()
        writer.close()

    server = await asyncio.start_server(hold_connection_silently, "127.0.0.1", 0, ssl=server_context)
    port = server.sockets[0].getsockname()[1]
    real_send = aiosmtplib.send

    # The client trusts only the test certificate, and the retry's STARTTLS attempt reaches the same silent port
    async def send_trusting_the_test_certificate(email_message, **kwargs):
        await real_send(email_message, tls_context=client_context, **kwargs)

    timeout = SILENT_SERVER_TEST_TIMEOUT_SECONDS
    monkeypatch.setattr(senders_module, "SMTP_HOST", "127.0.0.1")
    monkeypatch.setattr(senders_module, "SMTP_PORT", port)
    monkeypatch.setattr(senders_module, "IMPLICIT_TLS_PORT", port)
    monkeypatch.setattr(senders_module, "SMTP_USE_TLS", True)
    monkeypatch.setattr(senders_module, "MAIL_FROM", "no-reply@example.com")
    monkeypatch.setattr(senders_module, "SMTP_TIMEOUT_SECONDS", timeout)
    monkeypatch.setattr(senders_module.aiosmtplib, "send", send_trusting_the_test_certificate)

    started = time.monotonic()
    async with server:
        with pytest.raises(aiosmtplib.SMTPTimeoutError):
            await asyncio.wait_for(SmtpEmailSender().send("user@example.com", RenderedEmail(subject="Hi", text_body="Body")), 10 * timeout)
    elapsed = time.monotonic() - started

    # The first attempt waits one timeout for the greeting and the STARTTLS retry another, which is about 20 seconds at the
    # production 10. The margin is under one timeout, so a third attempt would fail the test
    assert elapsed < 2 * timeout + 0.5


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


def test_render_signup_confirmation_email_carries_link_in_both_parts():
    """The confirmation email includes the link and expiry in the HTML and text parts"""
    message = render_signup_confirmation_email("https://app.example.com/confirm-email?token=abc123", 24)

    for body in (message.text_body, message.html_body):
        assert "https://app.example.com/confirm-email?token=abc123" in body
        assert "24" in body


def test_render_reset_email_carries_link_in_both_parts():
    """The rendered reset email includes the link and expiry in the HTML and text parts"""
    message = render_reset_email("https://app.example.com/reset-password?token=abc123", 15)

    assert message.subject
    assert "abc123" in message.text_body
    assert "abc123" in message.html_body
    assert "15" in message.text_body
    assert "15" in message.html_body
