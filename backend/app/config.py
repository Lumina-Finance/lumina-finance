"""Application configuration loading and validation"""

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

from app.db.credentials import resolve_role_password

_BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(_BACKEND_DIR / ".env")


def _require(key: str) -> str:
    """Return the value of an environment variable or raise if missing.

    Args:
        key: The environment variable name.

    Returns:
        The environment variable value.

    Raises:
        RuntimeError: If the environment variable is not set.
    """
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


def _optional_csv_env(key: str) -> list[str]:
    """Return a comma-separated environment variable as a list."""
    return [value.strip() for value in os.getenv(key, "").split(",") if value.strip()]


def _optional_bool_env(key: str, default: bool) -> bool:
    """Return an optional boolean environment variable value

    Args:
        key: The environment variable name
        default: The fallback value when the variable is not set or blank

    Returns:
        The parsed boolean value

    Raises:
        RuntimeError: If the environment variable is not a supported boolean value
    """
    value = os.getenv(key)
    if value is None or not value.strip():
        return default

    normalized_value = value.strip().lower()
    if normalized_value == "true":
        return True
    if normalized_value == "false":
        return False

    raise RuntimeError(f"Invalid {key}={value!r}. Must be true or false")


def _unique_values(values: list[str]) -> list[str]:
    """Return values with duplicates removed while preserving order."""
    return list(dict.fromkeys(values))


def is_update_check_enabled(runtime: str, configured_enabled: bool) -> bool:
    """Return whether update checks are allowed for the current runtime

    Args:
        runtime: Application runtime mode
        configured_enabled: Public update check setting

    Returns:
        Whether update checks may run
    """
    return runtime == "server" and configured_enabled


# --- Database ---

# Every role connects to the same database, so host, port, and name are shared
DB_HOST = _require("DB_HOST")
DB_PORT = _require("DB_PORT")
DB_NAME = _require("DB_NAME")

# SQLAlchemy driver used for every async PostgreSQL connection
_DB_URL_SCHEME = "postgresql+asyncpg"

# The migrator role owns the tables and runs migrations and seeding. The app role
# serves normal requests and is the one restricted by row-level security. Both
# names are fixed and are never configurable by the operator
MIGRATOR_DB_USER = "lumina_migrator"
APP_DB_USER = "lumina_app"


def _build_database_url(user: str, password: str) -> str:
    """Return the asyncpg connection URL for a role against the shared database

    Args:
        user: Database role name
        password: Password for the role

    Returns:
        An asyncpg SQLAlchemy connection URL
    """
    return f"{_DB_URL_SCHEME}://{user}:{password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


# Each URL resolves its password lazily so a process only needs its own role's secret
def migration_database_url() -> str:
    """Return the connection URL for the migrator role"""
    return _build_database_url(MIGRATOR_DB_USER, resolve_role_password("migrator", generate=False))


def app_database_url() -> str:
    """Return the connection URL for the app role"""
    return _build_database_url(APP_DB_USER, resolve_role_password("app", generate=False))


def admin_database_url() -> str:
    """Return the connection URL for the admin role"""
    return _build_database_url(_require("DB_USER"), _require("DB_PASSWORD"))

RUNTIME = os.getenv("RUNTIME", "server").strip() or "server"
if RUNTIME not in ("server", "lambda"):
    raise RuntimeError(f"Invalid RUNTIME={RUNTIME!r}. Must be one of: server, lambda")

# --- Version checks ---

APP_VERSION = os.getenv("APP_VERSION", "").strip()
UPDATE_CHECKS_ENABLED = is_update_check_enabled(
    RUNTIME,
    _optional_bool_env("UPDATE_CHECKS_ENABLED", default=False),
)

# --- CORS ---

APP_URL = os.getenv("APP_URL", "").strip()

# APP_URL is the public CORS origin. ALLOWED_ORIGINS appends extra internal origins.
_configured_origins = [APP_URL, *_optional_csv_env("ALLOWED_ORIGINS")]
ALLOWED_ORIGINS = _unique_values([origin for origin in _configured_origins if origin]) or ["*"]

# --- WebAuthn ---

# The RP ID is the registrable domain a passkey is bound to and must match the page origin, so a
# bare IP is invalid and development must run over localhost. It defaults to the APP_URL host
WEBAUTHN_RP_NAME = os.getenv("WEBAUTHN_RP_NAME", "Lumina Finance").strip()
WEBAUTHN_RP_ID = os.getenv("WEBAUTHN_RP_ID", "").strip() or (urlparse(APP_URL).hostname or "")

# Origins a passkey ceremony is accepted from, defaulting to the app origin
WEBAUTHN_ORIGINS = _unique_values([o for o in (_optional_csv_env("WEBAUTHN_ORIGINS") or [APP_URL]) if o])

# A ceremony challenge is short-lived since it only has to survive one round trip to the authenticator
WEBAUTHN_CHALLENGE_EXPIRE_SECONDS = int(os.getenv("WEBAUTHN_CHALLENGE_EXPIRE_SECONDS", "300"))

# How long a staged first passkey and its unsaved recovery codes survive before an ordinary action
# such as login prunes them, since there is no reliable signal that a user abandoned the flow
TWO_FACTOR_STAGING_EXPIRE_SECONDS = int(os.getenv("TWO_FACTOR_STAGING_EXPIRE_SECONDS", "1800"))

# --- FX ---

FRANKFURTER_URL = os.getenv("FRANKFURTER_URL", "https://api.frankfurter.dev/v2").strip().rstrip("/")
if not FRANKFURTER_URL:
    raise RuntimeError("FRANKFURTER_URL cannot be blank")

# --- JWT ---

JWT_ALGORITHM = "RS256"
JWT_ACCESS_TOKEN_EXPIRE_SECONDS = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_SECONDS", "900"))
JWT_REFRESH_TOKEN_EXPIRE_SECONDS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_SECONDS", "86400"))
JWT_REFRESH_ROTATION_GRACE_SECONDS = int(os.getenv("JWT_REFRESH_ROTATION_GRACE_SECONDS", "5"))
JWT_ISSUER = os.getenv("JWT_ISSUER", "lumina-finance")

# Separate RSA key pairs for access and refresh tokens.
_keys_dir = Path("/data/keys")


def _load_key(env_var: str, default_path: Path) -> str:
    """Load an RSA private key from a file path.

    Checks the env var for a custom path, otherwise uses the default.
    Fails fast at startup if the key file is missing.

    Args:
        env_var: Environment variable name containing the key file path.
        default_path: Fallback path if the env var is not set.

    Returns:
        The PEM-encoded private key as a string.

    Raises:
        RuntimeError: If the key file does not exist.
    """
    key_path = Path(os.getenv(env_var) or default_path)
    if not key_path.exists():
        raise RuntimeError(
            f"JWT key not found at {key_path}. Run: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out {key_path}"
        )
    return key_path.read_text()


JWT_ACCESS_PRIVATE_KEY = _load_key("JWT_ACCESS_PRIVATE_KEY_PATH", _keys_dir / "access_private.pem")
JWT_REFRESH_PRIVATE_KEY = _load_key("JWT_REFRESH_PRIVATE_KEY_PATH", _keys_dir / "refresh_private.pem")

# Key IDs for JWT headers and JWKS matching. These do not need to match key filenames.
JWT_ACCESS_KID = os.getenv("JWT_ACCESS_KID", "access-kid").strip() or "access-kid"
JWT_REFRESH_KID = os.getenv("JWT_REFRESH_KID", "refresh-kid").strip() or "refresh-kid"

# --- Email ---

# EMAIL_BACKEND selects the email sender: smtp to deliver or logging for development
EMAIL_BACKEND_SMTP = "smtp"
EMAIL_BACKEND_LOGGING = "logging"
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", EMAIL_BACKEND_LOGGING).strip()

# An optional directory whose templates override the built-in email markup
EMAIL_TEMPLATE_DIR = os.getenv("EMAIL_TEMPLATE_DIR", "").strip()

SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_USE_TLS = _optional_bool_env("SMTP_USE_TLS", True)

# The sender display name is deliberately a constant, not a setting, so mail from a
# self-hosted instance is always identifiable as self-hosted
EMAIL_SENDER_NAME = "Lumina Finance (Self-Hosted)"

# The from address defaults to the SMTP username, which most providers expect anyway
MAIL_FROM = os.getenv("MAIL_FROM", "").strip() or SMTP_USERNAME

# --- Password reset ---

# Reset links are short-lived since the raw token grants account access until it expires
PASSWORD_RESET_TOKEN_EXPIRE_SECONDS = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_SECONDS", "900"))

# Cap on reset emails per account per rolling day, protecting the operator's mail quota from abuse
PASSWORD_RESET_DAILY_EMAIL_LIMIT = int(os.getenv("PASSWORD_RESET_DAILY_EMAIL_LIMIT", "3"))

# --- Two-factor authentication ---

# The challenge token bridges a verified password and the second factor, kept short so a
# captured token has a small window before the user must restart login
MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS = int(os.getenv("MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS", "120"))

# --- OIDC ---

# The generic slug accepts any standards-compliant provider such as Authentik or Authelia,
# while vendor slugs are presets whose issuer and display name are filled in automatically
# so operators only supply the client credentials
OIDC_GENERIC_SLUG = "generic"
OIDC_GENERIC_DEFAULT_DISPLAY_NAME = "OIDC"
OIDC_VENDOR_PRESETS = {
    "google": ("https://accounts.google.com", "Google"),
}

# The default scope set covers exactly the claims sign-in needs: subject, email, and name
OIDC_DEFAULT_SCOPES = "openid email profile"

# A sign-in roundtrip must finish within this window, covering the user authenticating at the provider
OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS = int(os.getenv("OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS", "600"))

# The onboarding token bridges a verified provider sign-in and the profile completion step, kept
# short since redoing the provider sign-in is cheap
OIDC_ONBOARDING_TOKEN_EXPIRE_SECONDS = int(os.getenv("OIDC_ONBOARDING_TOKEN_EXPIRE_SECONDS", "600"))

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
    """Return the OIDC providers declared in the environment

    Each slug listed in OIDC_PROVIDERS is read from its own OIDC_<SLUG>_* block. The slug
    is either generic, which requires an issuer, or a vendor preset that supplies its own

    Returns:
        Provider declarations in the order they are listed

    Raises:
        RuntimeError: A slug is unsupported, a required field is missing, or a value is invalid
    """
    configs = []
    for slug in _unique_values(_optional_csv_env("OIDC_PROVIDERS")):
        preset = OIDC_VENDOR_PRESETS.get(slug)
        if slug != OIDC_GENERIC_SLUG and preset is None:
            supported_slugs = ", ".join([OIDC_GENERIC_SLUG, *OIDC_VENDOR_PRESETS])
            raise RuntimeError(f"Unknown OIDC provider {slug!r}. Supported: {supported_slugs}")

        issuer = os.getenv(_oidc_env_key(slug, "ISSUER"), "").strip()
        if not issuer and preset is not None:
            issuer = preset[0]
        if not issuer:
            raise RuntimeError(f"Missing required environment variable: {_oidc_env_key(slug, 'ISSUER')}")

        client_id = os.getenv(_oidc_env_key(slug, "CLIENT_ID"), "").strip()
        client_secret = os.getenv(_oidc_env_key(slug, "CLIENT_SECRET"), "")
        if not client_id:
            raise RuntimeError(f"Missing required environment variable: {_oidc_env_key(slug, 'CLIENT_ID')}")
        if not client_secret:
            raise RuntimeError(f"Missing required environment variable: {_oidc_env_key(slug, 'CLIENT_SECRET')}")

        display_name = os.getenv(_oidc_env_key(slug, "DISPLAY_NAME"), "").strip()
        if not display_name:
            display_name = preset[1] if preset is not None else OIDC_GENERIC_DEFAULT_DISPLAY_NAME

        scopes = os.getenv(_oidc_env_key(slug, "SCOPES"), "").strip() or OIDC_DEFAULT_SCOPES
        if "openid" not in scopes.split():
            raise RuntimeError(f"OIDC provider {slug!r} scopes must include openid: {scopes!r}")

        configs.append(
            OidcProviderConfig(
                slug=slug,
                display_name=display_name,
                issuer=_validate_oidc_issuer(slug, issuer),
                client_id=client_id,
                client_secret=client_secret,
                scopes=scopes,
            )
        )

    # The callback URL every provider redirects to is derived from the public app origin,
    # so sign-in cannot work without one
    if configs and not APP_URL:
        raise RuntimeError("OIDC providers are configured but APP_URL is not set")
    return configs


OIDC_PROVIDER_CONFIGS = load_oidc_provider_configs()

# --- Dashboard ---

# How many of the user's most recent transactions the dashboard's recent-activity widget returns.
DASHBOARD_RECENT_TRANSACTIONS_LIMIT = 15

# How many calendar months the dashboard's savings rate history returns, inclusive of the
# current (in-progress) month. With the default of 7 the series covers the current month
# plus the six prior months.
DASHBOARD_SAVINGS_HISTORY_MONTHS = 7
