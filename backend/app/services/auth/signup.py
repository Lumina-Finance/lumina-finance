"""Signup service"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import current_user_id_ctx
from app.models.auth import AuthIdentity, PasswordCredential
from app.models.base import AuthProvider
from app.models.currency import Currency
from app.models.user import User
from app.schemas.auth import SignupRequest
from app.services.auth.password_helpers import hash_password
from app.services.auth.user_lookup import find_user_id_by_email


async def signup(db: AsyncSession, data: SignupRequest) -> User:
    """Register a new user with password credentials

    Creates the user, password auth identity, and password credential in one
    transaction after validating email uniqueness and base currency

    Args:
        db: Active database session
        data: Signup payload with user profile and credential fields

    Returns:
        Newly created user

    Raises:
        HTTPException: Email is already registered or base currency is invalid
    """
    user_id = uuid.uuid4()
    # Stamp the new user as the current identity before any query so their own row
    # passes the self-only users policy when it is inserted and read back
    current_user_id_ctx.set(user_id)

    await reject_registered_email(db, data.email)
    await reject_missing_base_currency(db, data.base_currency)

    user = User(
        id=user_id,
        email=data.email,
        first_name=data.first_name,
        last_name=data.last_name,
        tz=data.tz,
        base_currency=data.base_currency,
    )
    db.add(user)
    await db.flush()

    auth_identity = AuthIdentity(user_id=user.id, auth_provider=AuthProvider.PASSWORD)
    password_credential = PasswordCredential(
        user_id=user.id,
        password_hash=hash_password(data.password),
        password_algo="argon2id",  # noqa: S106
    )
    db.add(auth_identity)
    db.add(password_credential)

    await db.commit()
    await db.refresh(user)
    return user


async def reject_registered_email(db: AsyncSession, email: str) -> None:
    """Raise a conflict response when an email is already registered

    Args:
        db: Active database session
        email: Email address requested for signup

    Raises:
        HTTPException: Email is already registered
    """
    # Check for an existing user before creating a new password identity, through the
    # helper since the email lookup runs before any request identity exists
    if await find_user_id_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")


async def reject_missing_base_currency(db: AsyncSession, base_currency: str) -> None:
    """Raise an invalid-currency response when the base currency is missing

    Args:
        db: Active database session
        base_currency: Requested user base currency

    Raises:
        HTTPException: Base currency does not exist
    """
    currency_query = select(Currency).where(Currency.id == base_currency)

    # Check the requested base currency before assigning it to the new user
    result = await db.execute(currency_query)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")
