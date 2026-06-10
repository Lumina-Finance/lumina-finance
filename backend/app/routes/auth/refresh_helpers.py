"""Auth refresh route helpers"""

import uuid

import jwt
from fastapi import HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.auth.cookie_helpers import clear_refresh_cookie
from app.routes.auth.token_helpers import (
    decode_refresh_token,
    delete_session_tokens,
    get_active_token_by_jti,
    get_user_by_id,
    issue_and_store_tokens,
)
from app.schemas.auth import AuthResponse


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

    try:
        payload = decode_refresh_token(refresh_token)
    except jwt.PyJWTError:
        clear_refresh_cookie(response)

        # Suppress exception chaining to keep logs clean and avoid leaking JWT internals
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token") from None

    jti = payload.get("jti")
    sid = payload.get("sid")
    if not jti or not sid:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    active = await get_active_token_by_jti(db, jti)
    if not active:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is not active")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = await get_user_by_id(db, user_id)
    if not user:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    session_id = uuid.UUID(sid)
    await delete_session_tokens(db, session_id)
    auth_response = await issue_and_store_tokens(db, request, response, user, session_id=session_id)
    return auth_response
