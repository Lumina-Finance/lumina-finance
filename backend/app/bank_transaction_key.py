"""The server's secret key for the bank transaction hashes an OFX import keeps

The import page sends a SHA-256 digest of the bank account a statement names and the bank's ID for
each transaction. An account or card number has few enough possible values that the bare digest
could be reversed by trying them all, so the server keys it with HMAC-SHA256 under this secret
before staging or storing it. The secret is kept outside the database, so a copy of the database
alone cannot be searched that way

Losing or changing the secret leaves every saved hash unmatched, so a statement imported again
brings back the transactions an earlier import already saved. So the database records the key's
fingerprint, and app.db.bank_transaction_key refuses to start under another key or to generate one
over a database that has a key, until an operator accepts that cost with its reset command
"""

import functools
import hashlib
import hmac
import os
import re
import secrets
from pathlib import Path

from app.config import imports as import_config

# Persisted beside the database role secrets and the encryption key, on the data volume
_SECRETS_DIR = Path("/data/secrets")
KEY_FILE = _SECRETS_DIR / "bank_transaction_hash_key"
_KEY_FILE_MODE = 0o600
KEY_ENV_VAR = import_config.BANK_TRANSACTION_HASH_KEY_ENV_VAR

# 32 random bytes written as lower-case hex
_KEY_BYTES = 32
_KEY_PATTERN = re.compile(rf"[0-9a-f]{{{_KEY_BYTES * 2}}}")
_KEY_GUIDANCE = "64 lower-case hex characters, such as the output of: openssl rand -hex 32"


def generate_key() -> str:
    """Return a new key as lower-case hex"""
    return secrets.token_hex(_KEY_BYTES)


def key_fingerprint(key: bytes) -> str:
    """Return the SHA-256 hex digest the database records to say which key its hashes were made with

    The key is 32 random bytes, so its digest discloses nothing about it
    """
    return hashlib.sha256(key).hexdigest()


def is_key_available() -> bool:
    """Whether a key is set in the environment or persisted, without checking that it is valid"""
    return import_config.BANK_TRANSACTION_HASH_KEY is not None or KEY_FILE.exists()


def _parse_key(value: str, source: str) -> bytes:
    """Return the key's bytes, refusing a value that is not one

    Args:
        value: The key as written, surrounding whitespace removed
        source: Where it was read from, for the error

    Raises:
        RuntimeError: The value is not 64 lower-case hex characters
    """
    if not _KEY_PATTERN.fullmatch(value):
        raise RuntimeError(f"The bank transaction hash key in {source} must be {_KEY_GUIDANCE}")
    return bytes.fromhex(value)


def _persist_key(key: str) -> None:
    """Write a new key file readable by its owner alone from the moment it exists

    Raises:
        FileExistsError: Another process persisted a key first, which is left as it is
    """
    _SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _KEY_FILE_MODE)
    with os.fdopen(descriptor, "w") as key_file:
        key_file.write(key)


def resolve_key(*, generate: bool) -> bytes:
    """Return the key, from the environment, then the persisted file, then a new one when allowed

    Generating is only for a deployment no hash depends on yet, which app.db.bank_transaction_key
    checks before asking for it

    Args:
        generate: Whether a missing key may be generated and persisted

    Returns:
        The key's 32 bytes

    Raises:
        RuntimeError: The configured and persisted keys differ, either is malformed, or there is
            none and generation is not allowed
    """
    configured = import_config.BANK_TRANSACTION_HASH_KEY
    persisted = KEY_FILE.read_text().strip() if KEY_FILE.exists() else None

    # Only one of them matches the hashes already saved, and picking the wrong one would quietly
    # let every statement imported again bring back what is already there
    if configured and persisted and configured != persisted:
        raise RuntimeError(
            f"{KEY_ENV_VAR} does not match the key persisted at {KEY_FILE}. Set both to the key the "
            f"saved bank transaction hashes were made with"
        )

    if configured:
        return _parse_key(configured, KEY_ENV_VAR)

    if persisted:
        return _parse_key(persisted, str(KEY_FILE))

    if not generate:
        raise RuntimeError(f"Missing {KEY_ENV_VAR}. Set it to {_KEY_GUIDANCE}")

    generated = generate_key()
    _persist_key(generated)
    return bytes.fromhex(generated)


@functools.cache
def _key() -> bytes:
    """Return the key, resolved once, since it is stable for the life of the process"""
    return resolve_key(generate=False)


def seal_bank_transaction_hash(digest: str) -> str:
    """Return what the server keeps for the import page's digest of a bank transaction

    Args:
        digest: The page's SHA-256 digest, as 64 lower-case hex characters

    Returns:
        HMAC-SHA256 of the digest's 32 bytes under the key, as 64 lower-case hex characters
    """
    return hmac.new(_key(), bytes.fromhex(digest), hashlib.sha256).hexdigest()
