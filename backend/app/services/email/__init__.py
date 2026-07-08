"""Email service exports"""

from app.services.email.contract import EmailSender, RenderedEmail, get_email_sender, set_email_sender
from app.services.email.rendering import render_reset_email
from app.services.email.senders import build_email_sender

__all__ = [
    "EmailSender",
    "RenderedEmail",
    "build_email_sender",
    "get_email_sender",
    "render_reset_email",
    "set_email_sender",
]
