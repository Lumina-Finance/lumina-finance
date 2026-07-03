"""Argon2id hashing for secrets that warrant slow-hash protection at rest"""
import os

import argon2

# Lighter parameters under tests keep the suite fast without changing the algorithm
_HASHER = (
    argon2.PasswordHasher(time_cost=1, memory_cost=8, parallelism=1, hash_len=8, salt_len=8)
    if os.getenv("TESTING")
    else argon2.PasswordHasher()
)


def hash_secret(value: str) -> str:
    """Return an argon2id hash for a secret stored at rest

    Args:
        value: Plaintext secret to hash

    Returns:
        Argon2id hash string for database storage
    """
    return _HASHER.hash(value)


def is_secret_valid(value: str, secret_hash: str) -> bool:
    """Return whether a plaintext secret matches a stored argon2id hash

    Args:
        value: Plaintext secret to verify
        secret_hash: Stored argon2id hash

    Returns:
        Whether the secret matches the stored hash
    """
    try:
        return _HASHER.verify(secret_hash, value)
    except argon2.exceptions.VerifyMismatchError:
        return False


def hash_dummy_secret_for_timing() -> None:
    """Run one hash to even out the timing difference when no stored hash exists to compare"""
    _HASHER.hash("dummy-secret")
