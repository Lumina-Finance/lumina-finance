"""Password credential helpers"""
import os

import argon2

# Use lighter password hashing parameters in tests to keep the suite fast
_PASSWORD_HASHER = (
    argon2.PasswordHasher(time_cost=1, memory_cost=8, parallelism=1, hash_len=8, salt_len=8)
    if os.getenv("TESTING")
    else argon2.PasswordHasher()
)


def hash_password(password: str) -> str:
    """Return an argon2id hash for a plaintext password

    Args:
        password: Plaintext password to hash

    Returns:
        Argon2id hash string for database storage
    """
    password_hash = _PASSWORD_HASHER.hash(password)
    return password_hash


def is_password_valid(password: str, password_hash: str) -> bool:
    """Return whether a plaintext password matches a stored hash

    Args:
        password: Plaintext password to verify
        password_hash: Stored argon2id hash

    Returns:
        Whether the plaintext password matches the stored hash
    """
    try:
        is_valid = _PASSWORD_HASHER.verify(password_hash, password)
    except argon2.exceptions.VerifyMismatchError:
        return False

    return is_valid


def hash_dummy_password_for_timing() -> None:
    """Run one password hash to reduce missing-user timing differences"""
    _PASSWORD_HASHER.hash("dummy-password")
