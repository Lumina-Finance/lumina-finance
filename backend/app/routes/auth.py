import uuid
from typing import Annotated

import jwt

# Derive public keys for verifying tokens
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import (
    JWT_ACCESS_KID,
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_KID,
    JWT_REFRESH_PRIVATE_KEY,
    JWT_REFRESH_TOKEN_EXPIRE_SECONDS,
)
from app.database import get_db
from app.models.active_token import ActiveToken
from app.models.user import User
from app.request_security import request_is_https
from app.schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserInfo
from app.services.auth import create_access_token, create_refresh_token, login, signup

_refresh_public_key = load_pem_private_key(JWT_REFRESH_PRIVATE_KEY.encode(), password=None).public_key()
_access_public_key = load_pem_private_key(JWT_ACCESS_PRIVATE_KEY.encode(), password=None).public_key()
_security = HTTPBearer()

router = APIRouter(prefix="/auth", tags=["auth"])

_COOKIE_KEY = "refresh_token"
_COOKIE_PATH = "/"
_COOKIE_MAX_AGE = JWT_REFRESH_TOKEN_EXPIRE_SECONDS


def _set_refresh_cookie(request: Request, response: Response, token: str) -> None:
    """Set the refresh token as an httpOnly cookie on the response.

    Args:
        request: FastAPI request object.
        response: FastAPI response object.
        token: The encoded refresh JWT string.
    """
    response.set_cookie(
        key=_COOKIE_KEY,
        value=token,
        httponly=True,
        secure=request_is_https(request),
        samesite="lax",
        max_age=_COOKIE_MAX_AGE,
        path=_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh token cookie from the response.

    Args:
        response: FastAPI response object.
    """
    response.delete_cookie(key=_COOKIE_KEY, path=_COOKIE_PATH)


async def _issue_and_store_tokens(
    db: AsyncSession, request: Request, response: Response, user: User, session_id: uuid.UUID | None = None,
) -> AuthResponse:
    """Create a token pair, register them in active_tokens, and set the refresh cookie.

    Args:
        db: Async database session.
        request: FastAPI request object.
        response: FastAPI response object for setting the refresh cookie.
        user: The authenticated user.
        session_id: Reuse an existing session id when rotating tokens on refresh so the session
            identity persists across rotations. ``None`` (signup / login) mints a fresh one.

    Returns:
        AuthResponse with user info and access token.
    """
    # Purge expired tokens to prevent unbounded table growth
    await db.execute(delete(ActiveToken).where(ActiveToken.expires_at < sa_func.now()))

    if session_id is None:
        session_id = uuid.uuid4()

    access_token, access_jti, access_exp = create_access_token(user.id, session_id)
    refresh_token, refresh_jti, refresh_exp = create_refresh_token(user.id, session_id)

    db.add(ActiveToken(jti=access_jti, user_id=user.id, session_id=session_id, expires_at=access_exp))
    db.add(ActiveToken(jti=refresh_jti, user_id=user.id, session_id=session_id, expires_at=refresh_exp))
    await db.commit()

    _set_refresh_cookie(request, response, refresh_token)
    return AuthResponse(user=UserInfo.model_validate(user), access_token=access_token)


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup_route(
    data: SignupRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Register a new user and issue a JWT token pair.

    Args:
        data: Signup payload with email, password, name, timezone, and currency.
        request: FastAPI request object.
        response: FastAPI response object for setting the refresh cookie.
        db: Async database session.

    Returns:
        AuthResponse with user info and access token. Refresh token set as cookie.

    Raises:
        HTTPException 409: Email is already registered.
    """
    user = await signup(db, data)
    return await _issue_and_store_tokens(db, request, response, user)


@router.post("/login", response_model=AuthResponse)
async def login_route(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Authenticate a user and issue a JWT token pair.

    Args:
        data: Login payload with email and password.
        request: FastAPI request object.
        response: FastAPI response object for setting the refresh cookie.
        db: Async database session.

    Returns:
        AuthResponse with user info and access token. Refresh token set as cookie.

    Raises:
        HTTPException 401: Invalid credentials.
        HTTPException 423: Account temporarily locked.
    """
    user = await login(db, data)
    return await _issue_and_store_tokens(db, request, response, user)


@router.post("/refresh", response_model=AuthResponse)
async def refresh_route(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: str | None = Cookie(None),
):
    """Exchange a valid refresh token for a new access and refresh token pair.

    Verifies the refresh token is registered in active_tokens, deletes the
    old token, and issues a fresh pair.

    Args:
        response: FastAPI response object for setting the new refresh cookie.
        request: FastAPI request object.
        db: Async database session.
        refresh_token: Refresh token read from the cookie by FastAPI.

    Returns:
        AuthResponse with user info and new access token. New refresh token set as cookie.

    Raises:
        HTTPException 401: Missing, invalid, expired, or unregistered refresh token.
    """
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    try:
        payload = jwt.decode(refresh_token, _refresh_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER)
    except jwt.PyJWTError:
        _clear_refresh_cookie(response)
        # from None suppresses exception chaining to keep logs clean and avoid leaking JWT internals
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token") from None

    # Only accept tokens registered in the allowlist
    jti = payload.get("jti")
    sid = payload.get("sid")
    if not jti or not sid:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(ActiveToken).where(ActiveToken.jti == jti))
    active = result.scalar_one_or_none()
    if not active:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is not active")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Revoke the old access + refresh pair for this session, then mint a fresh pair that keeps the same session id
    session_id = uuid.UUID(sid)
    await db.execute(delete(ActiveToken).where(ActiveToken.session_id == session_id))
    return await _issue_and_store_tokens(db, request, response, user, session_id=session_id)


@router.post("/logout")
async def logout_route(
    response: Response,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Revoke every active token for the caller's session.

    Decodes the access token, reads its ``sid`` claim, and deletes every
    ``active_tokens`` row sharing that session id — killing both the access
    and refresh tokens for this device without touching the user's other
    sessions. The refresh cookie is cleared regardless of outcome.

    Args:
        response: FastAPI response object.
        credentials: Bearer token from the Authorization header.
        db: Async database session.

    Returns:
        Confirmation message.
    """
    try:
        access_payload = jwt.decode(
            credentials.credentials, _access_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER,
        )
        sid = access_payload.get("sid")
        if sid:
            await db.execute(delete(ActiveToken).where(ActiveToken.session_id == uuid.UUID(sid)))
    except jwt.PyJWTError:
        pass  # Best-effort — still clear the cookie and return 200

    await db.commit()
    _clear_refresh_cookie(response)
    return {"detail": "Logged out"}


@router.get("/.well-known/jwks.json")
async def jwks():
    """Publish the public keys in JWKS format for external token verification.

    Exposes both the access and refresh public keys so API Gateway,
    self-hosted reverse proxies, or other services can verify token
    signatures without access to the private keys.

    Returns:
        JWKS document containing both public keys.
    """
    from jwt.algorithms import RSAAlgorithm

    access_jwk = RSAAlgorithm.to_jwk(_access_public_key, as_dict=True)
    access_jwk["use"] = "sig"
    access_jwk["kid"] = JWT_ACCESS_KID
    access_jwk["alg"] = JWT_ALGORITHM

    refresh_jwk = RSAAlgorithm.to_jwk(_refresh_public_key, as_dict=True)
    refresh_jwk["use"] = "sig"
    refresh_jwk["kid"] = JWT_REFRESH_KID
    refresh_jwk["alg"] = JWT_ALGORITHM

    return {"keys": [access_jwk, refresh_jwk]}
