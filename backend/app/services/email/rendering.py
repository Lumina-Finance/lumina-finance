"""Email template rendering"""

from pathlib import Path

from jinja2 import ChoiceLoader, Environment, FileSystemLoader, select_autoescape

from app.config import EMAIL_TEMPLATE_DIR, MAIL_FROM_NAME
from app.services.email.contract import RenderedEmail

_BUILTIN_TEMPLATES_DIR = Path(__file__).parent / "templates"
_RESET_SUBJECT = "Reset your password"


def _build_environment() -> Environment:
    """Build the jinja environment, searching the override directory before the built-ins"""
    loaders = []
    if EMAIL_TEMPLATE_DIR:
        loaders.append(FileSystemLoader(EMAIL_TEMPLATE_DIR))
    loaders.append(FileSystemLoader(str(_BUILTIN_TEMPLATES_DIR)))

    # Autoescaping guards the HTML parts while leaving plain-text templates untouched
    return Environment(loader=ChoiceLoader(loaders), autoescape=select_autoescape(["html"]))


_environment = _build_environment()


def render_reset_email(reset_link: str, expiry_minutes: int) -> RenderedEmail:
    """Render the password reset email with its HTML and plain-text parts

    Args:
        reset_link: One-time reset URL carrying the raw token
        expiry_minutes: Minutes until the reset link expires

    Returns:
        The rendered subject and both body parts
    """
    context = {"app_name": MAIL_FROM_NAME, "reset_link": reset_link, "expiry_minutes": expiry_minutes}
    html_body = _environment.get_template("password_reset.html").render(context)
    text_body = _environment.get_template("password_reset.txt").render(context)
    return RenderedEmail(subject=_RESET_SUBJECT, text_body=text_body, html_body=html_body)
