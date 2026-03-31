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
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
JWT_ISSUER = os.getenv("JWT_ISSUER", "lumina-finance")

# Load RSA private key from file path. Falls back to backend/keys/private.pem for local dev.
_key_path = Path(os.getenv("JWT_PRIVATE_KEY_PATH", Path(__file__).resolve().parent.parent / "keys" / "private.pem"))
if not _key_path.exists():
    raise RuntimeError(
        f"JWT private key not found at {_key_path}. "
        f"Run: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out {_key_path}"
    )
JWT_PRIVATE_KEY = _key_path.read_text()
