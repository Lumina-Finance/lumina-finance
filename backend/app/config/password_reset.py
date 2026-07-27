"""Password reset token lifetime and send limits"""

import os

# Reset links are short-lived since the raw token grants account access until it expires
PASSWORD_RESET_TOKEN_EXPIRE_SECONDS = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_SECONDS", "900"))

# Cap on reset emails per account per rolling day, protecting the operator's mail quota from abuse
PASSWORD_RESET_DAILY_EMAIL_LIMIT = int(os.getenv("PASSWORD_RESET_DAILY_EMAIL_LIMIT", "3"))
