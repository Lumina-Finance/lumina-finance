"""Auth routes"""
import uuid
from typing import Annotated

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.routes.auth.cookie_helpers import clear_refresh_cookie
from app.routes.auth.jwks_helpers import build_jwks_response
from app.routes.auth.token_helpers import (
    decode_access_token,
    decode_refresh_token,
    delete_session_tokens,
    get_active_token_by_jti,
    get_user_by_id,
    issue_and_store_tokens,
)
from app.schemas.auth import AuthResponse, LoginRequest, SignupRequest
from app.services.auth import login, signup

_security = HTTPBearer()

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup_route(
    data: SignupRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Register a user and issue a token pair

    Args:
        data: Signup payload with email, password, name, timezone, and currency
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with user info and access token

    Raises:
        HTTPException: Email is already registered
    """
    user = await signup(db, data)
    auth_response = await issue_and_store_tokens(db, request, response, user)
    return auth_response


@router.post("/login", response_model=AuthResponse)
async def login_route(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Authenticate a user and issue a token pair

    Args:
        data: Login payload with email and password
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with user info and access token

    Raises:
        HTTPException: Credentials are invalid or the account is locked
    """
    user = await login(db, data)
    auth_response = await issue_and_store_tokens(db, request, response, user)
    return auth_response


@router.post("/refresh", response_model=AuthResponse)
async def refresh_route(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: str | None = Cookie(None),
):
    """Exchange a valid refresh token for a new token pair

    Args:
        request: FastAPI request object
        response: FastAPI response object for setting the new refresh cookie
        db: Active database session
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


@router.post("/logout")
async def logout_route(
    response: Response,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Revoke every active token for the caller's session

    Invalid bearer tokens are ignored because logout is best-effort and still
    clears the refresh cookie

    Args:
        response: FastAPI response object
        credentials: Bearer token from the Authorization header
        db: Active database session

    Returns:
        Logout confirmation
    """
    try:
        access_payload = decode_access_token(credentials.credentials)
        sid = access_payload.get("sid")
        if sid:
            await delete_session_tokens(db, uuid.UUID(sid))
    except jwt.PyJWTError:
        pass

    await db.commit()
    clear_refresh_cookie(response)
    logout_response = {"detail": "Logged out"}
    return logout_response


@router.get("/.well-known/jwks.json")
async def jwks():
    """Publish public keys for external token verification

    Returns:
        JWKS document containing access and refresh public keys
    """
    jwks_response = build_jwks_response()
    return jwks_response
