"""Passkey relying party identity and ceremony settings"""

import os
from urllib.parse import urlparse

from app.config.env import optional_csv_env, unique_values
from app.config.runtime import APP_URL

# The relying party name is the label the browser's passkey prompt shows. It is deliberately a
# constant, not a setting, so every install's prompt names the app the same way
WEBAUTHN_RP_NAME = "Lumina Finance Self-Hosted"

# The RP ID is the registrable domain a passkey is bound to and must match the page origin, so a
# bare IP is invalid and development must run over localhost. It defaults to the APP_URL host
WEBAUTHN_RP_ID = os.getenv("WEBAUTHN_RP_ID", "").strip() or (urlparse(APP_URL).hostname or "")

# Origins a passkey ceremony is accepted from, defaulting to the app origin
WEBAUTHN_ORIGINS = unique_values([o for o in (optional_csv_env("WEBAUTHN_ORIGINS") or [APP_URL]) if o])

# A ceremony challenge is short-lived since it only has to survive one round trip to the authenticator
WEBAUTHN_CHALLENGE_EXPIRE_SECONDS = int(os.getenv("WEBAUTHN_CHALLENGE_EXPIRE_SECONDS", "300"))
