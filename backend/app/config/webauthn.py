"""Passkey relying party identity and ceremony settings"""

import os
from urllib.parse import urlparse

from app.config.env import optional_csv_env, unique_values
from app.config.runtime import APP_URL, RUNTIME

# The relying party name is the label the browser's passkey prompt shows. It is deliberately fixed
# for the server runtime so a prompt from a self-hosted instance is always identifiable as
# self-hosted, while other runtimes may configure it through the environment
_DEFAULT_WEBAUTHN_RP_NAME = "Lumina Finance Self-Hosted"


def resolve_webauthn_rp_name(runtime: str, configured_name: str) -> str:
    """Return the relying party name honoured for the current runtime

    Args:
        runtime: Application runtime mode
        configured_name: Relying party name from the environment

    Returns:
        The relying party name shown by the browser's passkey prompt
    """
    if runtime == "server":
        return _DEFAULT_WEBAUTHN_RP_NAME
    return configured_name.strip() or _DEFAULT_WEBAUTHN_RP_NAME


WEBAUTHN_RP_NAME = resolve_webauthn_rp_name(RUNTIME, os.getenv("WEBAUTHN_RP_NAME", ""))

# The RP ID is the registrable domain a passkey is bound to and must match the page origin, so a
# bare IP is invalid and development must run over localhost. It defaults to the APP_URL host
WEBAUTHN_RP_ID = os.getenv("WEBAUTHN_RP_ID", "").strip() or (urlparse(APP_URL).hostname or "")

# Origins a passkey ceremony is accepted from, defaulting to the app origin
WEBAUTHN_ORIGINS = unique_values([o for o in (optional_csv_env("WEBAUTHN_ORIGINS") or [APP_URL]) if o])

# A ceremony challenge is short-lived since it only has to survive one round trip to the authenticator
WEBAUTHN_CHALLENGE_EXPIRE_SECONDS = int(os.getenv("WEBAUTHN_CHALLENGE_EXPIRE_SECONDS", "300"))
