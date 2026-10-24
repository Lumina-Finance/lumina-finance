"""Whether new accounts can be created"""

import os

from app.config.env import optional_bool_env

# Open by default so an upgrade leaves an existing instance as it was. Turning it off closes every
# route that creates an account, single sign-on onboarding included, with no exception for the first
REGISTRATION_ENABLED = optional_bool_env("REGISTRATION_ENABLED", default=True)

# How long an emailed sign-up confirmation link works. A day leaves room for slow mail, and the link
# grants nothing until its holder chooses a password
SIGNUP_CONFIRMATION_TOKEN_EXPIRE_SECONDS = 24 * 60 * 60

# Cap on sign-up emails per address per rolling day, protecting the operator's mail quota from abuse. A
# registered address is recorded like a new one but never emailed, so reaching the cap says nothing about either
SIGNUP_DAILY_EMAIL_LIMIT = int(os.getenv("SIGNUP_DAILY_EMAIL_LIMIT", "3"))
