"""Hashing for high-entropy secret tokens stored at rest"""

import hashlib


def hash_token(raw_token: str) -> str:
    """Return the SHA-256 hex digest stored for a high-entropy secret token

    Reset tokens are random, high-entropy, and looked up by equality, so a fast hash resists a
    database leak without the per-request cost of the Argon2 hashing used for user-chosen passwords
    """
    return hashlib.sha256(raw_token.encode()).hexdigest()
