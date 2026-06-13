"""Auth refresh route helpers"""

import uuid
from dataclasses import dataclass
from typing import NoReturn

import jwt
from fastapi import HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import AuthTokenKind
from app.routes.auth.cookie_helpers import clear_refresh_cookie
from app.routes.auth.token_helpers import (
    decode_refresh_token,
    get_active_session_by_id,
    get_active_token_by_jti,
    get_user_by_id,
    issue_and_store_tokens,
)
from app.schemas.auth import AuthResponse
from app.services.auth.sessions import delete_auth_session_tokens


@dataclass(frozen=True)
class _RefreshTokenClaims:
    """Parsed claims required to refresh an auth session"""

    token_id: uuid.UUID
    session_id: uuid.UUID
    user_id: uuid.UUID


async def refresh_auth_tokens(
    db: AsyncSession,
    request: Request,
    response: Response,
    refresh_token: str | None,
) -> AuthResponse:
    """Exchange a valid refresh token for a new token pair

    Args:
        db: Active database session
        request: FastAPI request object
        response: FastAPI response object for setting the new refresh cookie
        refresh_token: Refresh token read from the cookie by FastAPI

    Returns:
        Auth response with user info and a new access token

    Raises:
        HTTPException: Refresh token is missing, invalid, expired, or inactive
    """
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    claims = _get_refresh_token_claims(response, refresh_token)
    await _verify_refresh_token_allowlist(db, response, claims)

    user = await get_user_by_id(db, str(claims.user_id))
    if not user:
        _raise_refresh_token_error(response, "User not found")

    await delete_auth_session_tokens(db, claims.session_id)
    auth_response = await issue_and_store_tokens(db, request, response, user, session_id=claims.session_id)
    return auth_response


def _get_refresh_token_claims(response: Response, refresh_token: str) -> _RefreshTokenClaims:
    """Return parsed refresh-token claims or raise a refresh auth error

    Args:
        response: FastAPI response object for clearing the refresh cookie
        refresh_token: Encoded refresh token from the cookie

    Returns:
        Parsed refresh token identifiers
    """
    try:
        payload = decode_refresh_token(refresh_token)
    except jwt.PyJWTError:
        _raise_refresh_token_error(response, "Invalid or expired refresh token")

    jti = payload.get("jti")
    sid = payload.get("sid")
    user_id = payload.get("sub")
    if not jti or not sid or not user_id:
        _raise_refresh_token_error(response, "Invalid token")

    try:
        token_id = uuid.UUID(str(jti))
        session_id = uuid.UUID(str(sid))
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        _raise_refresh_token_error(response, "Invalid token")

    claims = _RefreshTokenClaims(token_id=token_id, session_id=session_id, user_id=user_uuid)
    return claims


async def _verify_refresh_token_allowlist(
    db: AsyncSession,
    response: Response,
    claims: _RefreshTokenClaims,
) -> None:
    """Verify that the refresh token and session are still allowlisted

    Args:
        db: Active database session
        response: FastAPI response object for clearing the refresh cookie
        claims: Parsed refresh token identifiers

    Returns:
        None
    """
    active = await get_active_token_by_jti(db, claims.token_id, AuthTokenKind.REFRESH)
    if not active:
        _raise_refresh_token_error(response, "Refresh token is not active")

    if active.session_id != claims.session_id or active.user_id != claims.user_id:
        _raise_refresh_token_error(response, "Invalid token")

    auth_session = await get_active_session_by_id(db, claims.session_id, claims.user_id)
    if not auth_session:
        _raise_refresh_token_error(response, "Session is not active")


def _raise_refresh_token_error(response: Response, detail: str) -> NoReturn:
    """Clear the refresh cookie and raise a refresh authentication error

    Args:
        response: FastAPI response object for clearing the refresh cookie
        detail: Response detail explaining why refresh failed

    Raises:
        HTTPException: Refresh failed and the cookie should be cleared
    """
    clear_refresh_cookie(response)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail) from None
