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
from app.database import current_user_id_ctx, get_db
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.user import User

# Derive the access public key from the private key for token verification
_private_key = load_pem_private_key(JWT_ACCESS_PRIVATE_KEY.encode(), password=None)
ACCESS_PUBLIC_KEY = _private_key.public_key()

_security = HTTPBearer()
_current_session_id: ContextVar[uuid.UUID | None] = ContextVar("current_session_id", default=None)

# The bearer challenge marks a 401 as an access-token failure, so the client refreshes and retries only
# on these, never on a wrong-credential 401 from a route, which it must not resend and double-count
_TOKEN_AUTH_HEADERS = {"WWW-Authenticate": "Bearer"}


def get_current_session_id() -> uuid.UUID | None:
    """Return the authenticated session id for the current request"""
    return _current_session_id.get()


async def get_authenticated_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Validate the access JWT and load the user, without enforcing the re-enrolment restriction

    Decodes the bearer token with the access public key, checks the access token and session are
    allowlisted, then loads the user. Only the routes a restricted session may reach should depend
    on this directly, since get_current_user adds the restriction check

    Args:
        credentials: Bearer token from the Authorization header
        db: Async database session

    Returns:
        The authenticated user

    Raises:
        HTTPException 401: Token is missing, invalid, expired, not allowlisted, or the user is gone
    """
    try:
        payload = jwt.decode(
            credentials.credentials,
            ACCESS_PUBLIC_KEY,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience="access",
        )
    except jwt.PyJWTError:
        # from None suppresses exception chaining to keep logs clean and avoid leaking JWT internals
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token", headers=_TOKEN_AUTH_HEADERS
        ) from None

    if payload.get("token_use") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token", headers=_TOKEN_AUTH_HEADERS)

    jti = payload.get("jti")
    sid = payload.get("sid")
    user_id = payload.get("sub")
    if not jti or not sid or not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token", headers=_TOKEN_AUTH_HEADERS)

    try:
        token_id = uuid.UUID(str(jti))
        session_id = uuid.UUID(str(sid))
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token", headers=_TOKEN_AUTH_HEADERS
        ) from None

    # Stamp the identity from the signature-verified token before any scoped query,
    # so this request's transactions carry it for row-level security
    current_user_id_ctx.set(user_uuid)

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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is not active", headers=_TOKEN_AUTH_HEADERS
        )

    active_session_query = select(AuthSession).where(
        AuthSession.id == session_id,
        AuthSession.user_id == user_uuid,
        AuthSession.expires_at > sa_func.now(),
    )

    # Fetch the session allowlist row so logout or session expiry invalidates every token
    result = await db.execute(active_session_query)
    active_session = result.scalar_one_or_none()
    if not active_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is not active", headers=_TOKEN_AUTH_HEADERS
        )
    _current_session_id.set(active_session.id)

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found", headers=_TOKEN_AUTH_HEADERS
        )

    return user


async def get_current_user(user: Annotated[User, Depends(get_authenticated_user)]) -> User:
    """Resolve the authenticated user and refuse a session pending second-factor re-enrolment

    The default for protected routes, so a recovery-code login can reach only the re-enrolment
    endpoints until a fresh second factor is confirmed

    Args:
        user: Authenticated user from get_authenticated_user

    Returns:
        The authenticated user

    Raises:
        HTTPException 403: The session must re-enrol a second factor first
    """
    if user.second_factor_reenrollment_required:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Two-factor re-enrolment required"
        )

    return user
