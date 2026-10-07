"""Second-factor challenge and enrolment staging lifetimes"""

import os

# The challenge token bridges a verified password and the second factor, kept short so a
# captured token has a small window before the user must restart login
MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS = int(os.getenv("MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS", "120"))

# How long pending authenticators, passkeys and recovery codes survive before the scheduled cleanup
# or the user's next login prunes them, since there is no reliable signal that a user abandoned the flow
TWO_FACTOR_STAGING_EXPIRE_SECONDS = int(os.getenv("TWO_FACTOR_STAGING_EXPIRE_SECONDS", "1800"))
