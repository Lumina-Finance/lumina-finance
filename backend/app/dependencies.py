"""FastAPI dependency helpers"""

import uuid
from contextvars import ContextVar
from typing import Annotated

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import JWT_ACCESS_PRIVATE_KEY, JWT_ALGORITHM, JWT_ISSUER
from app.database import get_db
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.user import User

# Derive the access public key from the private key for token verification
_private_key = load_pem_private_key(JWT_ACCESS_PRIVATE_KEY.encode(), password=None)
ACCESS_PUBLIC_KEY = _private_key.public_key()

_security = HTTPBearer()
_current_session_id: ContextVar[uuid.UUID | None] = ContextVar("current_session_id", default=None)


def get_current_session_id() -> uuid.UUID | None:
    """Return the authenticated session id for the current request."""
    return _current_session_id.get()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Extract and validate the access JWT from the Authorization header.

    Decodes the Bearer token using the access public key, verifies the access
    token and session are allowlisted, then loads the corresponding user from
    the database.

    Args:
        credentials: Bearer token extracted from the Authorization header.
        db: Async database session.

    Returns:
        The authenticated User.

    Raises:
        HTTPException 401: Token is missing, invalid, expired, not allowlisted, or user not found.
    """
    try:
        payload = jwt.decode(
            credentials.credentials,
            ACCESS_PUBLIC_KEY,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
        )
    except jwt.PyJWTError:
        # from None suppresses exception chaining to keep logs clean and avoid leaking JWT internals
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from None

    if payload.get("token_use") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    jti = payload.get("jti")
    sid = payload.get("sid")
    user_id = payload.get("sub")
    if not jti or not sid or not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        token_id = uuid.UUID(str(jti))
        session_id = uuid.UUID(str(sid))
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from None

    active_token_query = select(AuthToken).where(
        AuthToken.jti == token_id,
        AuthToken.user_id == user_uuid,
        AuthToken.session_id == session_id,
        AuthToken.token_kind == AuthTokenKind.ACCESS,
        AuthToken.expires_at > sa_func.now(),
    )

    # Fetch the access-token allowlist row so forged or rotated-out tokens cannot authorize
    result = await db.execute(active_token_query)
    active_token = result.scalar_one_or_none()
    if not active_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is not active")

    active_session_query = select(AuthSession).where(
        AuthSession.id == session_id,
        AuthSession.user_id == user_uuid,
        AuthSession.expires_at > sa_func.now(),
    )

    # Fetch the session allowlist row so logout or session expiry invalidates every token
    result = await db.execute(active_session_query)
    active_session = result.scalar_one_or_none()
    if not active_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is not active")
    _current_session_id.set(active_session.id)

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user
