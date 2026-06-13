"""Auth logout route helpers"""

import uuid

import jwt
from fastapi import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import AuthTokenKind
from app.routes.auth.cookie_helpers import clear_refresh_cookie
from app.routes.auth.token_helpers import decode_access_token, decode_refresh_token, get_active_token_by_jti
from app.services.auth.sessions import delete_auth_session


async def logout_auth_session(
    db: AsyncSession,
    response: Response,
    access_token: str | None,
    refresh_token: str | None,
) -> dict[str, str]:
    """Revoke an auth session when a valid token identifies it

    Invalid tokens are ignored because logout is best-effort and still clears
    the refresh cookie

    Args:
        db: Active database session
        response: FastAPI response object
        access_token: Optional bearer token from the Authorization header
        refresh_token: Optional refresh token from the refresh cookie

    Returns:
        Logout confirmation
    """
    session_id = await _get_logout_session_id(db, access_token, refresh_token)
    if session_id is not None:
        await delete_auth_session(db, session_id)

    await db.commit()
    clear_refresh_cookie(response)
    logout_response = {"detail": "Logged out"}
    return logout_response


async def _get_logout_session_id(
    db: AsyncSession,
    access_token: str | None,
    refresh_token: str | None,
) -> uuid.UUID | None:
    """Return the session id identified by a logout token

    Args:
        db: Active database session
        access_token: Optional bearer token from the Authorization header
        refresh_token: Optional refresh token from the refresh cookie

    Returns:
        Session identifier when a valid allowlisted token identifies one
    """
    if access_token:
        session_id = await _get_session_id_from_access_token(db, access_token)
        if session_id is not None:
            return session_id

    if refresh_token:
        return await _get_session_id_from_refresh_token(db, refresh_token)

    return None


async def _get_session_id_from_access_token(db: AsyncSession, access_token: str) -> uuid.UUID | None:
    """Return the session id from a valid access token

    Args:
        db: Active database session
        access_token: Bearer token from the Authorization header

    Returns:
        Session identifier when the token is active
    """
    try:
        payload = decode_access_token(access_token)
        token_id = uuid.UUID(str(payload.get("jti")))
        session_id = payload.get("sid")
        user_id = payload.get("sub")
        if not session_id or not user_id:
            return None
        session_uuid = uuid.UUID(str(session_id))
        user_uuid = uuid.UUID(str(user_id))
    except (TypeError, ValueError, jwt.PyJWTError):
        return None

    active_token = await get_active_token_by_jti(db, token_id, AuthTokenKind.ACCESS)
    if not active_token or active_token.session_id != session_uuid or active_token.user_id != user_uuid:
        return None

    return session_uuid


async def _get_session_id_from_refresh_token(db: AsyncSession, refresh_token: str) -> uuid.UUID | None:
    """Return the session id from a valid refresh token

    Args:
        db: Active database session
        refresh_token: Refresh token from the refresh cookie

    Returns:
        Session identifier when the token is active
    """
    try:
        payload = decode_refresh_token(refresh_token)
        token_id = uuid.UUID(str(payload.get("jti")))
        session_id = uuid.UUID(str(payload.get("sid")))
        user_id = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError, jwt.PyJWTError):
        return None

    active_token = await get_active_token_by_jti(db, token_id, AuthTokenKind.REFRESH)
    if not active_token or active_token.session_id != session_id or active_token.user_id != user_id:
        return None

    return session_id
