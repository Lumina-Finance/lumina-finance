"""JWT signing keys, lifetimes, and issuer settings"""

import os
from pathlib import Path

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
