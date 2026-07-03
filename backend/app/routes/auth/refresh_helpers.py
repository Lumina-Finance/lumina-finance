"""Auth refresh route helpers"""

import uuid
from dataclasses import dataclass
from typing import NoReturn

import jwt
from fastapi import HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import current_user_id_ctx
from app.models.base import AuthTokenKind
from app.routes.auth.cookie_helpers import clear_refresh_cookie
from app.routes.auth.token_helpers import (
    decode_refresh_token,
    get_active_session_by_id,
    get_active_token_by_jti,
    get_token_by_jti,
    get_user_by_id,
    issue_and_store_tokens,
)
from app.schemas.auth import AuthResponse


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

    # Stamp the identity from the signature-verified token before any query opens the
    # transaction the row-level security policies read
    current_user_id_ctx.set(claims.user_id)

    await _verify_refresh_token_allowlist(db, response, claims)

    user = await get_user_by_id(db, claims.user_id)
    if not user:
        _raise_refresh_token_error(response, "User not found")

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
    token = await get_token_by_jti(db, claims.token_id, claims.user_id, AuthTokenKind.REFRESH)
    if token is not None and token.session_id != claims.session_id:
        _raise_refresh_token_error(response, "Invalid token")

    auth_session = await get_active_session_by_id(db, claims.session_id, claims.user_id, lock_for_update=True)
    if not auth_session:
        _raise_refresh_token_error(response, "Session is not active")

    active = await get_active_token_by_jti(db, claims.token_id, claims.user_id, AuthTokenKind.REFRESH)
    if not active:
        await _raise_for_rotated_or_inactive_refresh_token(db, claims)
        _raise_refresh_token_error(response, "Refresh token is not active")

    if active.session_id != claims.session_id:
        _raise_refresh_token_error(response, "Invalid token")


async def _raise_for_rotated_or_inactive_refresh_token(
    db: AsyncSession,
    claims: _RefreshTokenClaims,
) -> None:
    """Raise a non-clearing conflict when a refresh token was already rotated away

    Args:
        db: Active database session
        claims: Parsed refresh token identifiers

    Returns:
        None

    Raises:
        HTTPException: Refresh token was already rotated while the session is still active
    """
    token = await get_token_by_jti(db, claims.token_id, claims.user_id, AuthTokenKind.REFRESH)
    if token is not None:
        return

    _raise_refresh_token_conflict("Refresh token was already rotated")


def _raise_refresh_token_conflict(detail: str) -> NoReturn:
    """Raise a refresh conflict without clearing the refresh cookie

    Args:
        detail: Response detail explaining why refresh did not produce a token pair

    Raises:
        HTTPException: Refresh request lost a rotation race
    """
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None


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
