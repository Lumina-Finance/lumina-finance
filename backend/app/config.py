import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    """Return the value of an environment variable or raise if missing."""
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
    """Load an RSA private key from env var path or default. Fails fast if missing."""
    key_path = Path(os.getenv(env_var, default_path))
    if not key_path.exists():
        raise RuntimeError(
            f"JWT key not found at {key_path}. "
            f"Run: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out {key_path}"
        )
    return key_path.read_text()


JWT_ACCESS_PRIVATE_KEY = _load_key("JWT_ACCESS_PRIVATE_KEY_PATH", _keys_dir / "access_private.pem")
JWT_REFRESH_PRIVATE_KEY = _load_key("JWT_REFRESH_PRIVATE_KEY_PATH", _keys_dir / "refresh_private.pem")
