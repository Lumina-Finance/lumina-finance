"""Email template rendering"""

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config.email import EMAIL_SENDER_NAME
from app.services.email.contract import RenderedEmail

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_RESET_SUBJECT = "Reset your password"

# Autoescaping guards the HTML parts while leaving plain-text templates untouched
_environment = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=select_autoescape(["html"])
)


def render_reset_email(reset_link: str, expiry_minutes: int) -> RenderedEmail:
    """Render the password reset email with its HTML and plain-text parts

    Args:
        reset_link: One-time reset URL carrying the raw token
        expiry_minutes: Minutes until the reset link expires

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": EMAIL_SENDER_NAME, "reset_link": reset_link, "expiry_minutes": expiry_minutes}
    html_body = _environment.get_template("password_reset.html").render(context)
    text_body = _environment.get_template("password_reset.txt").render(context)
    return RenderedEmail(subject=_RESET_SUBJECT, text_body=text_body, html_body=html_body)
