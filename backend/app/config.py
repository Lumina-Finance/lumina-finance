import os
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")


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


def _unique_values(values: list[str]) -> list[str]:
    """Return values with duplicates removed while preserving order."""
    return list(dict.fromkeys(values))


# --- Database ---

DB_HOST = _require("DB_HOST")
DB_PORT = _require("DB_PORT")
DB_NAME = _require("DB_NAME")
DB_USER = _require("DB_USER")
DB_PASSWORD = _require("DB_PASSWORD")

RUNTIME = os.getenv("RUNTIME", "server").strip() or "server"
if RUNTIME not in ("server", "lambda"):
    raise RuntimeError(
        f"Invalid RUNTIME={RUNTIME!r}. Must be one of: server, lambda"
    )

# --- CORS ---

APP_URL = os.getenv("APP_URL", "").strip()

# APP_URL is the public CORS origin. ALLOWED_ORIGINS appends extra internal origins.
_configured_origins = [APP_URL, *_optional_csv_env("ALLOWED_ORIGINS")]
ALLOWED_ORIGINS = _unique_values([origin for origin in _configured_origins if origin]) or ["*"]

DATABASE_URL = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# --- JWT ---

JWT_ALGORITHM = "RS256"
JWT_ACCESS_TOKEN_EXPIRE_SECONDS = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_SECONDS", "900"))
JWT_REFRESH_TOKEN_EXPIRE_SECONDS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_SECONDS", "86400"))
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
            f"JWT key not found at {key_path}. "
            f"Run: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out {key_path}"
        )
    return key_path.read_text()


JWT_ACCESS_PRIVATE_KEY = _load_key("JWT_ACCESS_PRIVATE_KEY_PATH", _keys_dir / "access_private.pem")
JWT_REFRESH_PRIVATE_KEY = _load_key("JWT_REFRESH_PRIVATE_KEY_PATH", _keys_dir / "refresh_private.pem")

# Key IDs for JWT headers and JWKS matching. These do not need to match key filenames.
JWT_ACCESS_KID = os.getenv("JWT_ACCESS_KID", "access-kid").strip() or "access-kid"
JWT_REFRESH_KID = os.getenv("JWT_REFRESH_KID", "refresh-kid").strip() or "refresh-kid"

# --- Dashboard ---

# How many of the user's most recent transactions the dashboard's recent-activity widget returns.
DASHBOARD_RECENT_TRANSACTIONS_LIMIT = 15

# How many calendar months the dashboard's savings rate history returns, inclusive of the
# current (in-progress) month. With the default of 7 the series covers the current month
# plus the six prior months.
DASHBOARD_SAVINGS_HISTORY_MONTHS = 7
