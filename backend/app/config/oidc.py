"""OIDC provider declarations read from the environment"""

import os
from dataclasses import dataclass
from urllib.parse import urlparse

from app.config.env import optional_bool_env
from app.config.runtime import APP_URL

# The generic slug accepts any standards-compliant provider such as Authentik or Authelia,
# so an operator supplies its issuer, client credentials, and an optional display name
OIDC_GENERIC_SLUG = "generic"
OIDC_GENERIC_DEFAULT_DISPLAY_NAME = "OIDC"

# The default scope set covers exactly the claims sign-in needs: subject, email, and name
OIDC_DEFAULT_SCOPES = "openid email profile"

# Whether onboarding a new account requires the provider to assert email_verified as true. Strict by
# default so an unverified address cannot create an account. Self-hosted providers such as Authentik
# and Authelia hardcode this claim with no real verification and disagree on its default, so an operator
# using one sets this false to onboard on any provider-supplied email. Existing-account takeover is
# prevented regardless, since a provider sign-in is never auto-linked by email
OIDC_REQUIRE_VERIFIED_EMAIL = optional_bool_env("OIDC_REQUIRE_VERIFIED_EMAIL", default=True)

# A sign-in roundtrip must finish within this window, covering the user authenticating at the provider
OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS = int(os.getenv("OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS", "600"))

# The onboarding token bridges a verified provider sign-in and the profile completion step, kept
# short since redoing the provider sign-in is cheap
OIDC_ONBOARDING_TOKEN_EXPIRE_SECONDS = int(os.getenv("OIDC_ONBOARDING_TOKEN_EXPIRE_SECONDS", "600"))

# The set-password authorization bridges a provider reauth and the password submit that follows,
# kept short since it is spent on the request right after re-authentication
OIDC_REAUTH_STEPUP_TOKEN_EXPIRE_SECONDS = int(os.getenv("OIDC_REAUTH_STEPUP_TOKEN_EXPIRE_SECONDS", "300"))

# A reauth step-up must prove the provider authenticated the user this recently, so a silently reused
# provider session cannot stand in for a fresh re-authentication when a passwordless account sets its
# first password. The window is verified against the ID token auth_time rather than trusting prompt=login
OIDC_REAUTH_MAX_AGE_SECONDS = 300


@dataclass(frozen=True)
class OidcProviderConfig:
    """One OIDC provider declaration read from the environment"""

    slug: str
    display_name: str
    issuer: str
    client_id: str
    client_secret: str
    scopes: str


def _oidc_env_key(slug: str, field: str) -> str:
    """Return the environment variable name for one field of a provider block"""
    return f"OIDC_{slug.upper().replace('-', '_')}_{field}"


def _validate_oidc_issuer(slug: str, issuer: str) -> str:
    """Return the issuer URL after enforcing the transport policy

    Every discovery, token, and key fetch trusts this origin, so HTTPS is required, with
    plain HTTP allowed only for loopback development providers. The value is kept exactly
    as configured because the provider must echo it verbatim in discovery and every ID
    token, and some providers such as Authentik publish issuers with a trailing slash

    Args:
        slug: Provider the issuer belongs to, named in the failure message
        issuer: Issuer URL as configured

    Returns:
        The issuer exactly as configured

    Raises:
        RuntimeError: The issuer is not HTTPS or loopback HTTP
    """
    parsed_issuer = urlparse(issuer)
    is_loopback_http = parsed_issuer.scheme == "http" and parsed_issuer.hostname in ("localhost", "127.0.0.1")
    if parsed_issuer.scheme != "https" and not is_loopback_http:
        raise RuntimeError(f"OIDC provider {slug!r} issuer must use https: {issuer!r}")
    return issuer


def load_oidc_provider_configs() -> list[OidcProviderConfig]:
    """Return the OIDC providers configured through their environment blocks

    A provider is enabled the moment its OIDC_<SLUG>_CLIENT_ID is set, and its remaining required
    variables are then validated so a half-configured provider fails at startup rather than being
    silently skipped. The public build ships only the generic slug, which any standards-compliant
    provider is configured through

    Returns:
        The enabled provider declarations

    Raises:
        RuntimeError: An enabled provider is missing a required field or carries an invalid value
    """
    slug = OIDC_GENERIC_SLUG

    # The client id doubles as the enable switch, so an unset one leaves sign-in off without an error
    client_id = os.getenv(_oidc_env_key(slug, "CLIENT_ID"), "").strip()
    if not client_id:
        return []

    issuer = os.getenv(_oidc_env_key(slug, "ISSUER"), "").strip()
    if not issuer:
        raise RuntimeError(f"Missing required environment variable: {_oidc_env_key(slug, 'ISSUER')}")

    client_secret = os.getenv(_oidc_env_key(slug, "CLIENT_SECRET"), "")
    if not client_secret:
        raise RuntimeError(f"Missing required environment variable: {_oidc_env_key(slug, 'CLIENT_SECRET')}")

    # The callback URL the provider redirects to is derived from the public app origin,
    # so sign-in cannot work without one
    if not APP_URL:
        raise RuntimeError("An OIDC provider is configured but APP_URL is not set")

    display_name = os.getenv(_oidc_env_key(slug, "DISPLAY_NAME"), "").strip() or OIDC_GENERIC_DEFAULT_DISPLAY_NAME

    scopes = os.getenv(_oidc_env_key(slug, "SCOPES"), "").strip() or OIDC_DEFAULT_SCOPES
    if "openid" not in scopes.split():
        raise RuntimeError(f"OIDC provider {slug!r} scopes must include openid: {scopes!r}")

    return [
        OidcProviderConfig(
            slug=slug,
            display_name=display_name,
            issuer=_validate_oidc_issuer(slug, issuer),
            client_id=client_id,
            client_secret=client_secret,
            scopes=scopes,
        )
    ]


OIDC_PROVIDER_CONFIGS = load_oidc_provider_configs()
