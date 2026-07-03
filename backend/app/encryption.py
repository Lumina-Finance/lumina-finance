"""Symmetric encryption for secrets stored at rest"""

import functools
import os
import sys
from pathlib import Path

from cryptography.fernet import Fernet

# Persisted alongside the database role secrets so a deployment keeps its secrets together
_SECRETS_DIR = Path("/data/secrets")
_KEY_FILE = _SECRETS_DIR / "app_encryption_key"
_KEY_FILE_MODE = 0o600
_KEY_ENV_VAR = "APP_ENCRYPTION_KEY"


def generate_encryption_key() -> str:
    """Return a new url-safe base64 Fernet key"""
    return Fernet.generate_key().decode()


def resolve_encryption_key(*, generate: bool) -> str:
    """Return the application symmetric encryption key

    Resolution order is the environment variable, then the persisted file, then a freshly
    generated key when generation is allowed, mirroring how database role secrets resolve

    Args:
        generate: Whether a missing key may be generated and persisted

    Returns:
        The url-safe base64 Fernet key

    Raises:
        RuntimeError: No key is configured or persisted and generation is not allowed
    """
    configured_key = os.getenv(_KEY_ENV_VAR)
    if configured_key:
        return configured_key

    if _KEY_FILE.exists():
        return _KEY_FILE.read_text().strip()

    if not generate:
        raise RuntimeError(f"No application encryption key. Set {_KEY_ENV_VAR} or provision it first")

    generated_key = generate_encryption_key()
    _SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    _KEY_FILE.write_text(generated_key)
    _KEY_FILE.chmod(_KEY_FILE_MODE)
    return generated_key


@functools.cache
def _fernet() -> Fernet:
    """Return the Fernet built from the resolved key

    The key is stable for the life of the process, so it is cached. A serving process only
    reads the key since provisioning is what generates it
    """
    return Fernet(resolve_encryption_key(generate=False).encode())


def encrypt(plaintext: str) -> str:
    """Return the Fernet token to persist for a plaintext secret"""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    """Return the plaintext for a Fernet token read from storage"""
    return _fernet().decrypt(token.encode()).decode()


def main() -> None:
    """Generate and persist the encryption key when a deployment has none yet"""
    key_present = bool(os.getenv(_KEY_ENV_VAR)) or _KEY_FILE.exists()
    resolve_encryption_key(generate=True)
    if key_present:
        print("Application encryption key already configured", file=sys.stderr)
    else:
        print(f"Generated application encryption key at {_KEY_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
