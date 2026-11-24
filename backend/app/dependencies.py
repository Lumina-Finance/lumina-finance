"""FastAPI dependency helpers"""

import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config.jwt import JWT_ALGORITHM, JWT_ISSUER
from app.database import current_session_id_ctx, current_user_id_ctx, get_db
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.user import User
from app.services.auth.sessions import is_session_live
from app.services.auth.tokens import access_verification_key

_security = HTTPBearer()

# The bearer challenge marks a 401 as an access-token failure, so the client refreshes and retries only
# on these, never on a wrong-credential 401 from a route, which it must not resend and double-count
_TOKEN_AUTH_HEADERS = {"WWW-Authenticate": "Bearer"}


_SCHEDULED_FOR_DELETION_DETAIL = "Your profile is scheduled for deletion"


async def get_authenticated_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Validate the access JWT and load the user, without enforcing the re-enrolment restriction

    Decodes the bearer token with the access key its header names, checks the access token and session are
    allowlisted, then loads the user. Only the routes a restricted session may reach should depend
    on this directly, since get_current_user adds the restriction check. A user whose profile is marked
    for deletion is refused, so a session made while the deletion waits reaches no route that uses this

    Args:
        credentials: Bearer token from the Authorization header
        db: Async database session

    Returns:
        The authenticated user

    Raises:
        HTTPException 401: Token is missing, invalid, expired, not allowlisted, or the user is gone
        HTTPException 403: The user's profile is marked for deletion
    """
    user = await _load_authenticated_user(credentials, db)
    if user.deletion_requested_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_SCHEDULED_FOR_DELETION_DETAIL)

    return user


async def get_user_who_may_cancel_deletion(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Validate the access JWT and load the user, letting a profile that is waiting to be deleted through

    The one route that cancels a deletion depends on this instead of get_authenticated_user. A marked
    profile whose due time has passed is refused as every other marked profile is

    Args:
        credentials: Bearer token from the Authorization header
        db: Async database session

    Returns:
        The authenticated user, marked for deletion or not

    Raises:
        HTTPException 401: Token is missing, invalid, expired, not allowlisted, or the user is gone
        HTTPException 403: The user's profile is marked for deletion and its due time has passed or was never set
    """
    user = await _load_authenticated_user(credentials, db)
    if user.deletion_requested_at is not None and not user.is_waiting_to_be_deleted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_SCHEDULED_FOR_DELETION_DETAIL)

    return user


async def _load_authenticated_user(credentials: HTTPAuthorizationCredentials, db: AsyncSession) -> User:
    """Validate the access JWT and load the user whatever the state of their profile"""
    try:
        payload = jwt.decode(
            credentials.credentials,
            access_verification_key(credentials.credentials),
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience="access",
        )
    except jwt.PyJWTError:
        # from None suppresses exception chaining to keep logs clean and avoid leaking JWT internals
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token", headers=_TOKEN_AUTH_HEADERS) from None

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
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token", headers=_TOKEN_AUTH_HEADERS) from None

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
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is not active", headers=_TOKEN_AUTH_HEADERS)

    active_session_query = select(AuthSession).where(
        AuthSession.id == session_id,
        AuthSession.user_id == user_uuid,
        is_session_live(),
    )

    # Fetch the session allowlist row so logout or session expiry invalidates every token
    result = await db.execute(active_session_query)
    active_session = result.scalar_one_or_none()
    if not active_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is not active", headers=_TOKEN_AUTH_HEADERS)
    current_session_id_ctx.set(active_session.id)

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found", headers=_TOKEN_AUTH_HEADERS)

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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Set up two-factor authentication again before you continue")

    return user
