import argon2

_ph = argon2.PasswordHasher()


def _hash_password(password: str) -> str:
    return _ph.hash(password)


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except argon2.exceptions.VerifyMismatchError:
        return False
