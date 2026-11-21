"""JWT signing keys, lifetimes, and issuer settings"""

import os
from pathlib import Path

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key

JWT_ALGORITHM = "RS256"
JWT_ACCESS_TOKEN_EXPIRE_SECONDS = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_SECONDS", "900"))
JWT_REFRESH_TOKEN_EXPIRE_SECONDS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_SECONDS", "86400"))
JWT_REFRESH_ROTATION_GRACE_SECONDS = int(os.getenv("JWT_REFRESH_ROTATION_GRACE_SECONDS", "5"))
JWT_ISSUER = os.getenv("JWT_ISSUER", "lumina-finance")

# A session ends this long after sign-in however often it refreshes, so a refresh token that leaks
# cannot keep a session alive forever
SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

# Separate RSA key pairs for access and refresh tokens
_keys_dir = Path("/data/keys")


def load_signing_key(name: str, env_var: str, default_path: Path) -> RSAPrivateKey:
    """Read and validate one RSA private signing key

    Every refusal names the key and the setting that points at it, so a start-up that stops says
    which of the two keys to fix. Fails fast at startup

    Args:
        name: Which key this is, such as "access", for the messages
        env_var: Environment variable name containing the key file path
        default_path: Fallback path if the env var is not set

    Returns:
        The parsed private key

    Raises:
        RuntimeError: The file is missing or unreadable, or is not an unencrypted PEM RSA private key
    """
    key_path = Path(os.getenv(env_var) or default_path)
    try:
        pem = key_path.read_bytes()
    except FileNotFoundError:
        raise RuntimeError(
            f"The {name} token signing key was not found at {key_path}. Set {env_var} to a file holding it, "
            f"such as one made with: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out {key_path}"
        ) from None
    except OSError as error:
        raise RuntimeError(f"The {name} token signing key at {key_path} could not be read ({error.strerror}). Check {env_var}") from None

    try:
        key = load_pem_private_key(pem, password=None)
    except ValueError, TypeError, UnsupportedAlgorithm:
        # The library's own message can quote part of the file, so none of it is repeated
        raise RuntimeError(f"The {name} token signing key at {key_path} is not an unencrypted PEM private key. Check {env_var}") from None
    if not isinstance(key, RSAPrivateKey):
        raise RuntimeError(f"The {name} token signing key at {key_path} is not an RSA private key. Check {env_var}")
    return key


# Parsed here and nowhere else, since validating a 4096-bit key is costly. Every other module signs and
# verifies with these objects
JWT_ACCESS_PRIVATE_KEY = load_signing_key("access", "JWT_ACCESS_PRIVATE_KEY_PATH", _keys_dir / "access_private.pem")
JWT_REFRESH_PRIVATE_KEY = load_signing_key("refresh", "JWT_REFRESH_PRIVATE_KEY_PATH", _keys_dir / "refresh_private.pem")
JWT_ACCESS_PUBLIC_KEY = JWT_ACCESS_PRIVATE_KEY.public_key()
JWT_REFRESH_PUBLIC_KEY = JWT_REFRESH_PRIVATE_KEY.public_key()

# Key IDs for JWT headers and JWKS matching. These do not need to match key filenames
JWT_ACCESS_KID = os.getenv("JWT_ACCESS_KID", "access-kid").strip() or "access-kid"
JWT_REFRESH_KID = os.getenv("JWT_REFRESH_KID", "refresh-kid").strip() or "refresh-kid"
