"""Password credential helpers"""
from app.services.auth.secret_hashing import hash_dummy_secret_for_timing, hash_secret, is_secret_valid


def hash_password(password: str) -> str:
    """Return an argon2id hash for a plaintext password

    Args:
        password: Plaintext password to hash

    Returns:
        Argon2id hash string for database storage
    """
    return hash_secret(password)


def is_password_valid(password: str, password_hash: str) -> bool:
    """Return whether a plaintext password matches a stored hash

    Args:
        password: Plaintext password to verify
        password_hash: Stored argon2id hash

    Returns:
        Whether the plaintext password matches the stored hash
    """
    return is_secret_valid(password, password_hash)


def hash_dummy_password_for_timing() -> None:
    """Run one password hash to reduce missing-user timing differences"""
    hash_dummy_secret_for_timing()
