"""Second-factor challenge and enrolment staging lifetimes"""

import os

# The challenge token bridges a verified password and the second factor, kept short so a
# captured token has a small window before the user must restart login
MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS = int(os.getenv("MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS", "120"))

# How long a staged first passkey and its unsaved recovery codes survive before an ordinary action
# such as login prunes them, since there is no reliable signal that a user abandoned the flow
TWO_FACTOR_STAGING_EXPIRE_SECONDS = int(os.getenv("TWO_FACTOR_STAGING_EXPIRE_SECONDS", "1800"))
