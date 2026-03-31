import uuid
from datetime import UTC, datetime, timedelta

import argon2
import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_PRIVATE_KEY,
    JWT_REFRESH_TOKEN_EXPIRE_HOURS,
)
from app.models.auth import AuthIdentity, PasswordCredential
from app.models.base import AuthProvider
from app.models.user import User
from app.schemas.auth import SignupRequest

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


async def signup(db: AsyncSession, data: SignupRequest) -> User:
    """Register a new user with password credentials."""
    # Check if email is already registered
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=data.email,
        first_name=data.first_name,
        last_name=data.last_name,
        tz=data.tz,
        base_currency=data.base_currency,
    )
    db.add(user)
    await db.flush()

    db.add(AuthIdentity(user_id=user.id, auth_provider=AuthProvider.PASSWORD))
    db.add(
        PasswordCredential(
            user_id=user.id,
            password_hash=_hash_password(data.password),
            password_algo="argon2id",  # noqa: S106 — algorithm name, not a secret
        )
    )

    await db.commit()
    await db.refresh(user)
    return user
