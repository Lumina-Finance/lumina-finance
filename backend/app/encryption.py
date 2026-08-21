"""Symmetric encryption for secrets stored at rest

This module holds no database dependency, so provisioning a key and binding it to the data
it protects live in app.db.encryption_key instead
"""

import functools
import hashlib
import os
from pathlib import Path

from cryptography.fernet import Fernet

# Persisted alongside the database role secrets so a deployment keeps its secrets together
_SECRETS_DIR = Path("/data/secrets")
KEY_FILE = _SECRETS_DIR / "app_encryption_key"
_KEY_FILE_MODE = 0o600
KEY_ENV_VAR = "APP_ENCRYPTION_KEY"


def generate_encryption_key() -> str:
    """Return a new url-safe base64 Fernet key"""
    return Fernet.generate_key().decode()


def key_fingerprint(key: str) -> str:
    """Return the hex digest identifying a key without disclosing it

    The digest is what a database records to state which key its secrets are under, so it
    is stored where the key itself must never be

    Args:
        key: The url-safe base64 Fernet key

    Returns:
        The SHA-256 hex digest of the key
    """
    return hashlib.sha256(key.encode()).hexdigest()


def resolve_encryption_key(*, generate: bool) -> str:
    """Return the application symmetric encryption key

    Resolution order is the environment variable, then the persisted file, then a freshly
    generated key when generation is allowed, mirroring how database role secrets resolve

    Args:
        generate: Whether a missing key may be generated and persisted

    Returns:
        The url-safe base64 Fernet key

    Raises:
        RuntimeError: The configured and persisted keys conflict, or no key is configured
            or persisted and generation is not allowed
    """
    # Both sources are stripped so one key has one spelling everywhere. A key carrying a
    # trailing newline, which is what an env file or a mounted secret produces, decodes to
    # the same 32 bytes and decrypts everything, but compares unequal to the same key
    # without it, which would fail the fingerprint check and defeat the rotation's
    # refusal to rotate onto the key already in use
    configured = os.getenv(KEY_ENV_VAR)
    configured_key = configured.strip() if configured else None
    persisted_key = KEY_FILE.read_text().strip() if KEY_FILE.exists() else None

    # A configured key that differs from the persisted one would silently win and every
    # secret encrypted under the persisted key would fail to decrypt at runtime, so refuse
    # to start instead of picking a winner. The guidance deliberately does not offer
    # removing either one, since which of the two is live depends on whether a rotation
    # has run, and removing the live one leaves the stored secrets unreadable
    if configured_key and persisted_key and configured_key != persisted_key:
        raise RuntimeError(
            f"{KEY_ENV_VAR} does not match the key persisted at {KEY_FILE}. "
            f"Only one of them decrypts the stored secrets, so set both to that key. "
            f"After a rotation it is the new key, and the stale file is the one to replace"
        )

    if configured_key:
        return configured_key

    if persisted_key:
        return persisted_key

    if not generate:
        raise RuntimeError(f"No application encryption key. Set {KEY_ENV_VAR} or provision it first")

    generated_key = generate_encryption_key()
    _SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_text(generated_key)
    KEY_FILE.chmod(_KEY_FILE_MODE)
    return generated_key


@functools.cache
def _fernet() -> Fernet:
    """Return the Fernet built from the resolved key

    The key is stable for the life of the process, so it is cached. That cache is also why
    a key rotation runs with the app stopped: a serving process would keep writing new
    secrets under the key it resolved at startup, onto rows the rotation has already
    rewritten, and nothing could read them afterwards
    """
    return Fernet(resolve_encryption_key(generate=False).encode())


def encrypt(plaintext: str) -> str:
    """Return the Fernet token to persist for a plaintext secret"""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    """Return the plaintext for a Fernet token read from storage"""
    return _fernet().decrypt(token.encode()).decode()
