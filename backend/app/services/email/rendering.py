"""Email template rendering"""

from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config.email import DEFAULT_EMAIL_SENDER_NAME
from app.config.profile_deletion import DELETION_REMINDER_LEAD
from app.services.email.contract import RenderedEmail
from app.services.service_name import resolve_service_name

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_RESET_SUBJECT = "Reset your password"
_SIGNUP_CONFIRMATION_SUBJECT = "Confirm your email"
_EMAIL_CHANGE_SUBJECT = "Confirm your new email"
_EMAIL_CHANGE_NOTICE_SUBJECT = "Your email was changed"

# English month names, so a date reads the same whatever locale the server runs in
_MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

# Autoescaping guards the HTML parts while leaving plain-text templates untouched
_environment = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=select_autoescape(["html"]))


def email_service_name() -> str:
    """Return the name an email's From header, title and wording give the service, read at each call"""
    return resolve_service_name(DEFAULT_EMAIL_SENDER_NAME)


def render_reset_email(reset_link: str, expiry_minutes: int) -> RenderedEmail:
    """Render the password reset email with its HTML and plain-text parts

    Args:
        reset_link: One-time reset URL carrying the raw token
        expiry_minutes: Minutes until the reset link expires

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": email_service_name(), "reset_link": reset_link, "expiry_minutes": expiry_minutes}
    html_body = _environment.get_template("password_reset.html").render(context)
    text_body = _environment.get_template("password_reset.txt").render(context)
    return RenderedEmail(subject=_RESET_SUBJECT, text_body=text_body, html_body=html_body)


def render_signup_confirmation_email(confirm_link: str, expiry_hours: int) -> RenderedEmail:
    """Render the email that carries a new address its confirmation link

    Args:
        confirm_link: URL carrying the signed confirmation token
        expiry_hours: Hours until the confirmation link expires

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": email_service_name(), "confirm_link": confirm_link, "expiry_hours": expiry_hours}
    html_body = _environment.get_template("signup_confirmation.html").render(context)
    text_body = _environment.get_template("signup_confirmation.txt").render(context)
    return RenderedEmail(subject=_SIGNUP_CONFIRMATION_SUBJECT, text_body=text_body, html_body=html_body)


def render_email_change_email(confirm_link: str, expiry_minutes: int) -> RenderedEmail:
    """Render the email that carries a new address its confirmation link

    It holds only the link and how long it works, since the address may not belong to the person asking

    Args:
        confirm_link: One-time URL carrying the raw token
        expiry_minutes: Minutes until the confirmation link expires

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": email_service_name(), "confirm_link": confirm_link, "expiry_minutes": expiry_minutes}
    html_body = _environment.get_template("email_change.html").render(context)
    text_body = _environment.get_template("email_change.txt").render(context)
    return RenderedEmail(subject=_EMAIL_CHANGE_SUBJECT, text_body=text_body, html_body=html_body)


def render_email_change_notice_email(new_email: str) -> RenderedEmail:
    """Render the notice the old address gets once an account's email has changed, with no link to act on

    Args:
        new_email: The address the account has now

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": email_service_name(), "new_email": new_email}
    html_body = _environment.get_template("email_change_notice.html").render(context)
    text_body = _environment.get_template("email_change_notice.txt").render(context)
    return RenderedEmail(subject=_EMAIL_CHANGE_NOTICE_SUBJECT, text_body=text_body, html_body=html_body)


def render_action_needed_email(subject: str, lead: str, accounts: Sequence[str], closing: str) -> RenderedEmail:
    """Render an email saying what only the user can do for bank sync to resume, with its HTML and plain-text parts

    Args:
        subject: The subject line
        lead: The opening, saying what happened
        accounts: The names of the accounts it affects, listed after the opening
        closing: What to do, or what happens next

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": email_service_name(), "lead": lead, "accounts": accounts, "closing": closing}
    html_body = _environment.get_template("bank_sync_action_needed.html").render(context)
    text_body = _environment.get_template("bank_sync_action_needed.txt").render(context)
    return RenderedEmail(subject=subject, text_body=text_body, html_body=html_body)


def render_profile_deletion_scheduled_email(due_at: datetime, tz: str | None = None) -> RenderedEmail:
    """Render the email telling a user their profile will be deleted on a date, and that signing in before it cancels

    Args:
        due_at: When the deletion is due. Only its date is shown
        tz: The user's IANA timezone, whose calendar gives the date. UTC when unset

    Returns:
        The rendered subject and both body parts
    """
    due_date = _plain_date(due_at, tz)
    context = {"app_name": email_service_name(), "due_date": due_date}
    html_body = _environment.get_template("profile_deletion_scheduled.html").render(context)
    text_body = _environment.get_template("profile_deletion_scheduled.txt").render(context)
    return RenderedEmail(subject=f"Your profile will be deleted on {due_date}", text_body=text_body, html_body=html_body)


def render_profile_deletion_reminder_email(due_at: datetime, tz: str | None = None) -> RenderedEmail:
    """Render the reminder that a profile's deletion is only days away, and that signing in before it cancels

    Args:
        due_at: When the deletion is due. Only its date is shown
        tz: The user's IANA timezone, whose calendar gives the date. UTC when unset

    Returns:
        The rendered subject and both body parts
    """
    due_date = _plain_date(due_at, tz)
    days_left = DELETION_REMINDER_LEAD.days
    context = {"app_name": email_service_name(), "due_date": due_date, "days_left": days_left}
    html_body = _environment.get_template("profile_deletion_reminder.html").render(context)
    text_body = _environment.get_template("profile_deletion_reminder.txt").render(context)
    return RenderedEmail(subject=f"Your profile will be deleted in {days_left} days or less", text_body=text_body, html_body=html_body)


def render_profile_deletion_done_email() -> RenderedEmail:
    """Render the email confirming a profile and its data have been deleted

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": email_service_name()}
    html_body = _environment.get_template("profile_deletion_done.html").render(context)
    text_body = _environment.get_template("profile_deletion_done.txt").render(context)
    return RenderedEmail(subject="Your profile was deleted", text_body=text_body, html_body=html_body)


def _plain_date(moment: datetime, tz: str | None) -> str:
    """Write the date of an instant in a zone as a day, a month name and a year, such as 3 December 2026

    Args:
        moment: The instant to write
        tz: IANA name of the zone whose calendar decides the day, UTC when unset or not a known zone
    """
    try:
        zone = ZoneInfo(tz) if tz else UTC
    except ZoneInfoNotFoundError, ValueError:
        zone = UTC
    local = moment.astimezone(zone)
    return f"{local.day} {_MONTH_NAMES[local.month - 1]} {local.year}"
