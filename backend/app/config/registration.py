"""Whether new accounts can be created"""

from app.config.env import optional_bool_env

# Open by default so an upgrade leaves an existing instance as it was. Turning it off closes every
# route that creates an account, single sign-on onboarding included, with no exception for the first
REGISTRATION_ENABLED = optional_bool_env("REGISTRATION_ENABLED", default=True)
