import uuid
from datetime import UTC, datetime, timedelta

import argon2
import jwt

from app.config import (
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_PRIVATE_KEY,
    JWT_REFRESH_TOKEN_EXPIRE_HOURS,
)

_ph = argon2.PasswordHasher()


def _hash_password(password: str) -> str:
    return _ph.hash(password)


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except argon2.exceptions.VerifyMismatchError:
        return False


def create_access_token(user_id: uuid.UUID) -> str:
    """Signed with the access key — only verifiable by the access public key."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
        "iss": JWT_ISSUER,
    }
    return jwt.encode(payload, JWT_ACCESS_PRIVATE_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: uuid.UUID) -> str:
    """Signed with the refresh key — only verifiable by the refresh public key."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(hours=JWT_REFRESH_TOKEN_EXPIRE_HOURS),
        "iss": JWT_ISSUER,
    }
    return jwt.encode(payload, JWT_REFRESH_PRIVATE_KEY, algorithm=JWT_ALGORITHM)
