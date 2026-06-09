"""Auth token route helpers"""
import uuid
from typing import Any

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import (
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_PRIVATE_KEY,
)
from app.models.active_token import ActiveToken
from app.models.user import User
from app.routes.auth.cookie_helpers import set_refresh_cookie
from app.schemas.auth import AuthResponse, UserInfo
from app.services.auth import create_access_token, create_refresh_token

_refresh_public_key = load_pem_private_key(JWT_REFRESH_PRIVATE_KEY.encode(), password=None).public_key()
_access_public_key = load_pem_private_key(JWT_ACCESS_PRIVATE_KEY.encode(), password=None).public_key()


def get_refresh_public_key():
    """Return the public key used to verify refresh tokens

    Returns:
        Refresh JWT public key
    """
    return _refresh_public_key


def get_access_public_key():
    """Return the public key used to verify access tokens

    Returns:
        Access JWT public key
    """
    return _access_public_key


def decode_refresh_token(refresh_token: str) -> dict[str, Any]:
    """Return decoded refresh token claims

    Args:
        refresh_token: Encoded refresh JWT string

    Returns:
        Decoded refresh token claims

    Raises:
        PyJWTError: Refresh token cannot be decoded or verified
    """
    payload = jwt.decode(refresh_token, _refresh_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER)
    return payload


def decode_access_token(access_token: str) -> dict[str, Any]:
    """Return decoded access token claims

    Args:
        access_token: Encoded access JWT string

    Returns:
        Decoded access token claims

    Raises:
        PyJWTError: Access token cannot be decoded or verified
    """
    payload = jwt.decode(access_token, _access_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER)
    return payload


async def get_active_token_by_jti(db: AsyncSession, token_jti: str) -> ActiveToken | None:
    """Return an active token row by JWT identifier

    Args:
        db: Active database session
        token_jti: JWT identifier from token claims

    Returns:
        Active token row when the JWT identifier is allowlisted
    """
    active_token_query = select(ActiveToken).where(ActiveToken.jti == token_jti)

    # Fetch the active-token allowlist row for the decoded refresh token identifier
    result = await db.execute(active_token_query)
    active_token = result.scalar_one_or_none()
    return active_token


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    """Return a user row by identifier

    Args:
        db: Active database session
        user_id: User identifier from token claims

    Returns:
        User row when the token subject still exists
    """
    user_query = select(User).where(User.id == user_id)

    # Fetch the token subject so refresh fails if the user no longer exists
    result = await db.execute(user_query)
    user = result.scalar_one_or_none()
    return user


async def delete_session_tokens(db: AsyncSession, session_id: uuid.UUID) -> None:
    """Delete all active tokens for a session

    Args:
        db: Active database session
        session_id: Session identifier shared by access and refresh tokens
    """
    delete_query = delete(ActiveToken).where(ActiveToken.session_id == session_id)

    # Delete every active token in the session so access and refresh tokens are revoked together
    await db.execute(delete_query)


async def issue_and_store_tokens(
    db: AsyncSession,
    request: Request,
    response: Response,
    user: User,
    session_id: uuid.UUID | None = None,
) -> AuthResponse:
    """Create a token pair, store it, and set the refresh cookie

    Args:
        db: Active database session
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        user: Authenticated user receiving the tokens
        session_id: Existing session identifier reused during refresh

    Returns:
        Auth response with user info and access token
    """
    expired_token_delete_query = delete(ActiveToken).where(ActiveToken.expires_at < sa_func.now())

    # Delete expired tokens before issuing a new pair so the allowlist table stays bounded
    await db.execute(expired_token_delete_query)

    if session_id is None:
        session_id = uuid.uuid4()

    access_token, access_jti, access_exp = create_access_token(user.id, session_id)
    refresh_token, refresh_jti, refresh_exp = create_refresh_token(user.id, session_id)

    db.add(ActiveToken(jti=access_jti, user_id=user.id, session_id=session_id, expires_at=access_exp))
    db.add(ActiveToken(jti=refresh_jti, user_id=user.id, session_id=session_id, expires_at=refresh_exp))
    await db.commit()

    set_refresh_cookie(request, response, refresh_token)
    auth_response = AuthResponse(user=UserInfo.model_validate(user), access_token=access_token)
    return auth_response
