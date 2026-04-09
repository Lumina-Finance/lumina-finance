import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


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


# --- Database ---

DB_HOST = _require("DB_HOST")
DB_PORT = _require("DB_PORT")
DB_NAME = _require("DB_NAME")
DB_USER = _require("DB_USER")
DB_PASSWORD = _require("DB_PASSWORD")
APP_ENV = _require("APP_ENV")
if APP_ENV not in ("development", "staging", "production"):
    raise RuntimeError(
        f"Invalid APP_ENV={APP_ENV!r}. Must be one of: development, staging, production"
    )

RUNTIME = _require("RUNTIME")
if RUNTIME not in ("server", "lambda"):
    raise RuntimeError(
        f"Invalid RUNTIME={RUNTIME!r}. Must be one of: server, lambda"
    )

# --- CORS ---

# Comma-separated list of allowed origins (e.g., "https://domain.com")
ALLOWED_ORIGINS = [o.strip() for o in _require("ALLOWED_ORIGINS").split(",")]

DATABASE_URL = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# --- JWT ---

JWT_ALGORITHM = "RS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
JWT_REFRESH_TOKEN_EXPIRE_HOURS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_HOURS", "24"))
JWT_ISSUER = os.getenv("JWT_ISSUER", "lumina-finance")

# Separate RSA key pairs for access and refresh tokens.
# Falls back to backend/keys/ for local dev.
_keys_dir = Path(__file__).resolve().parent.parent / "keys"


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
    key_path = Path(os.getenv(env_var, default_path))
    if not key_path.exists():
        raise RuntimeError(
            f"JWT key not found at {key_path}. "
            f"Run: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out {key_path}"
        )
    return key_path.read_text()


JWT_ACCESS_PRIVATE_KEY = _load_key("JWT_ACCESS_PRIVATE_KEY_PATH", _keys_dir / "access_private.pem")
JWT_REFRESH_PRIVATE_KEY = _load_key("JWT_REFRESH_PRIVATE_KEY_PATH", _keys_dir / "refresh_private.pem")

# Key IDs for JWKS matching — bump version and date when rotating keys
JWT_ACCESS_KID = _require("JWT_ACCESS_KID")
JWT_REFRESH_KID = _require("JWT_REFRESH_KID")
