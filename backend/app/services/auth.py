import os
import uuid
from datetime import UTC, datetime, timedelta

import argon2
import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    JWT_ACCESS_KID,
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_KID,
    JWT_REFRESH_PRIVATE_KEY,
    JWT_REFRESH_TOKEN_EXPIRE_HOURS,
)
from app.models.auth import AuthIdentity, PasswordCredential
from app.models.base import AuthProvider, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.user import User
from app.schemas.auth import LoginRequest, SignupRequest

# Default categories seeded for every new user.
_DEFAULT_CATEGORIES: list[tuple[str, CategoryKind]] = [
    ("Groceries", CategoryKind.EXPENSE),
    ("Dining", CategoryKind.EXPENSE),
    ("Takeout", CategoryKind.EXPENSE),
    ("Housing", CategoryKind.EXPENSE),
    ("Gas", CategoryKind.EXPENSE),
    ("Public Transit", CategoryKind.EXPENSE),
    ("Utilities", CategoryKind.EXPENSE),
    ("Health", CategoryKind.EXPENSE),
    ("Entertainment", CategoryKind.EXPENSE),
    ("Shopping", CategoryKind.EXPENSE),
    ("Insurance", CategoryKind.EXPENSE),
    ("Education", CategoryKind.EXPENSE),
    ("Personal Care", CategoryKind.EXPENSE),
    ("Gifts & Donations", CategoryKind.EXPENSE),
    ("Pets", CategoryKind.EXPENSE),
    ("Travel", CategoryKind.EXPENSE),
    ("Taxes", CategoryKind.EXPENSE),
    ("Salary", CategoryKind.INCOME),
    ("Freelance", CategoryKind.INCOME),
    ("Bonus", CategoryKind.INCOME),
    ("Interest", CategoryKind.INCOME),
    ("Dividends", CategoryKind.INCOME),
    ("Capital Gains/Losses", CategoryKind.INCOME),
    ("Rental Income", CategoryKind.INCOME),
    ("Other Income", CategoryKind.INCOME),
    ("Transfer", CategoryKind.TRANSFER),
    ("Credit Card Payment", CategoryKind.TRANSFER),
    ("Debt Payment", CategoryKind.TRANSFER),
]


async def _seed_default_categories(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Create the default set of categories for a newly registered user."""
    for name, kind in _DEFAULT_CATEGORIES:
        db.add(Category(owner_id=user_id, name=name, kind=kind))

# Use less secure params in testing to keep the suite fast; production uses defaults
_ph = (
    argon2.PasswordHasher(time_cost=1, memory_cost=8, parallelism=1, hash_len=8, salt_len=8)
    if os.getenv("TESTING")
    else argon2.PasswordHasher()
)


def _hash_password(password: str) -> str:
    """Hash a plaintext password using argon2id.

    Args:
        password: The plaintext password to hash.

    Returns:
        The argon2id hash string for storage in the database.
    """
    return _ph.hash(password)


def _verify_password(password: str, password_hash: str) -> bool:
    """Compare a plaintext password against a stored argon2id hash.

    Args:
        password: The plaintext password to verify.
        password_hash: The stored argon2id hash.

    Returns:
        True if the password matches, False otherwise.
    """
    try:
        return _ph.verify(password_hash, password)
    except argon2.exceptions.VerifyMismatchError:
        return False


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, uuid.UUID, datetime]:
    """Create a short-lived JWT access token signed with the access private key.

    Args:
        user_id: The user's UUID to embed as the token subject.
        session_id: Shared id for the access + refresh pair, embedded as the ``sid`` claim
            so logout can revoke the whole session from either token.

    Returns:
        Tuple of (encoded JWT string, jti, expires_at) for storing in active_tokens.
    """
    now = datetime.now(UTC)
    jti = uuid.uuid4()
    expires_at = now + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "jti": str(jti),
        "sid": str(session_id),
        "iat": now,
        "exp": expires_at,
        "iss": JWT_ISSUER,
    }
    token = jwt.encode(payload, JWT_ACCESS_PRIVATE_KEY, algorithm=JWT_ALGORITHM, headers={"kid": JWT_ACCESS_KID})
    return token, jti, expires_at


def create_refresh_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, uuid.UUID, datetime]:
    """Create a longer-lived JWT refresh token signed with the refresh private key.

    Args:
        user_id: The user's UUID to embed as the token subject.
        session_id: Shared id for the access + refresh pair, embedded as the ``sid`` claim
            so refresh rotation and logout can act on the whole session.

    Returns:
        Tuple of (encoded JWT string, jti, expires_at) for storing in active_tokens.
    """
    now = datetime.now(UTC)
    jti = uuid.uuid4()
    expires_at = now + timedelta(hours=JWT_REFRESH_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "jti": str(jti),
        "sid": str(session_id),
        "iat": now,
        "exp": expires_at,
        "iss": JWT_ISSUER,
    }
    token = jwt.encode(payload, JWT_REFRESH_PRIVATE_KEY, algorithm=JWT_ALGORITHM, headers={"kid": JWT_REFRESH_KID})
    return token, jti, expires_at


async def signup(db: AsyncSession, data: SignupRequest) -> User:
    """Register a new user with password credentials.

    Creates a User, AuthIdentity, and PasswordCredential in a single transaction.

    Args:
        db: Async database session.
        data: Signup payload with email, password, name, timezone, and currency.

    Returns:
        The newly created User.

    Raises:
        HTTPException 409: Email is already registered.
    """
    # Check if email is already registered
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    # Validate base currency exists
    currency_result = await db.execute(select(Currency).where(Currency.id == data.base_currency))
    if not currency_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

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

    await _seed_default_categories(db, user.id)
    await db.commit()
    await db.refresh(user)
    return user


# Lockout policy
_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_MINUTES = 30


async def login(db: AsyncSession, data: LoginRequest) -> User:
    """Authenticate a user by email and password.

    Verifies credentials and enforces account lockout after repeated failures.

    Args:
        db: Async database session.
        data: Login payload with email and password.

    Returns:
        The authenticated User.

    Raises:
        HTTPException 401: Invalid email or password.
        HTTPException 423: Account temporarily locked after too many failed attempts.
    """
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user:
        # Prevent timing-based attacks — always run a hash so both paths take equal time
        _ph.hash("dummy-password")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    result = await db.execute(select(PasswordCredential).where(PasswordCredential.user_id == user.id))
    credential = result.scalar_one_or_none()
    if not credential:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Reject if account is temporarily locked
    if credential.locked_until and credential.locked_until > datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")

    if not _verify_password(data.password, credential.password_hash):
        # Track failed attempts and lock after threshold
        credential.failed_attempt_count += 1
        if credential.failed_attempt_count >= _MAX_FAILED_ATTEMPTS:
            credential.locked_until = datetime.now(UTC) + timedelta(minutes=_LOCKOUT_MINUTES)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Reset on successful login
    credential.failed_attempt_count = 0
    credential.locked_until = None
    await db.commit()
    return user
