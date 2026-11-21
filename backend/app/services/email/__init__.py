"""Email service exports"""

from app.services.email.contract import (
    EmailSender,
    RenderedEmail,
    get_email_sender,
    is_email_sender_installed,
    set_email_sender,
)
from app.services.email.rendering import (
    render_action_needed_email,
    render_email_change_email,
    render_email_change_notice_email,
    render_reset_email,
    render_signup_confirmation_email,
)
from app.services.email.senders import build_email_sender

__all__ = [
    "EmailSender",
    "RenderedEmail",
    "build_email_sender",
    "get_email_sender",
    "is_email_sender_installed",
    "render_action_needed_email",
    "render_email_change_email",
    "render_email_change_notice_email",
    "render_reset_email",
    "render_signup_confirmation_email",
    "set_email_sender",
]
