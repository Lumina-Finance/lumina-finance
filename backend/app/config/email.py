"""Outgoing mail transport and sender identity"""

import os

from app.config.env import optional_bool_env

# EMAIL_BACKEND selects the email sender: smtp to deliver or logging for development
EMAIL_BACKEND_SMTP = "smtp"
EMAIL_BACKEND_LOGGING = "logging"
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", EMAIL_BACKEND_LOGGING).strip()

SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_USE_TLS = optional_bool_env("SMTP_USE_TLS", True)

# The sender display name is deliberately a constant, not a setting, so mail from a
# self-hosted instance is always identifiable as self-hosted
EMAIL_SENDER_NAME = "Lumina Finance (Self-Hosted)"

# The from address defaults to the SMTP username, which most providers expect anyway
MAIL_FROM = os.getenv("MAIL_FROM", "").strip() or SMTP_USERNAME
