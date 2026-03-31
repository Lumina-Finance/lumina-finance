from typing import Annotated

import jwt

# Derive the refresh public key for verifying refresh tokens
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import JWT_ALGORITHM, JWT_ISSUER, JWT_REFRESH_PRIVATE_KEY, JWT_REFRESH_TOKEN_EXPIRE_HOURS
from app.database import get_db
from app.models.user import User
from app.schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserInfo
from app.services.auth import create_access_token, create_refresh_token, login, signup

_refresh_public_key = load_pem_private_key(JWT_REFRESH_PRIVATE_KEY.encode(), password=None).public_key()

router = APIRouter(prefix="/auth", tags=["auth"])

_COOKIE_KEY = "refresh_token"
_COOKIE_MAX_AGE = JWT_REFRESH_TOKEN_EXPIRE_HOURS * 3600  # Convert hours to seconds for browser cookie


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Set the refresh token as an httpOnly cookie on the response.

    Args:
        response: FastAPI response object.
        token: The encoded refresh JWT string.
    """
    response.set_cookie(
        key=_COOKIE_KEY,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=_COOKIE_MAX_AGE,
        path="/auth",  # Only sent to auth endpoints
    )


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup_route(
    data: SignupRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Register a new user and issue a JWT token pair.

    Args:
        data: Signup payload with email, password, name, timezone, and currency.
        response: FastAPI response object for setting the refresh cookie.
        db: Async database session.

    Returns:
        AuthResponse with user info and access token. Refresh token set as cookie.

    Raises:
        HTTPException 409: Email is already registered.
    """
    user = await signup(db, data)
    access_token = create_access_token(user.id)
    _set_refresh_cookie(response, create_refresh_token(user.id))
    return AuthResponse(user=UserInfo.model_validate(user), access_token=access_token)


@router.post("/login", response_model=AuthResponse)
async def login_route(
    data: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Authenticate a user and issue a JWT token pair.

    Args:
        data: Login payload with email and password.
        response: FastAPI response object for setting the refresh cookie.
        db: Async database session.

    Returns:
        AuthResponse with user info and access token. Refresh token set as cookie.

    Raises:
        HTTPException 401: Invalid credentials.
        HTTPException 423: Account temporarily locked.
    """
    user = await login(db, data)
    access_token = create_access_token(user.id)
    _set_refresh_cookie(response, create_refresh_token(user.id))
    return AuthResponse(user=UserInfo.model_validate(user), access_token=access_token)


def _clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh token cookie from the response.

    Args:
        response: FastAPI response object.
    """
    response.delete_cookie(key=_COOKIE_KEY, path="/auth")


@router.post("/refresh", response_model=AuthResponse)
async def refresh_route(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: str | None = Cookie(None),
):
    """Exchange a valid refresh token for a new access and refresh token pair.

    Reads the refresh token from the httpOnly cookie, verifies it against
    the refresh public key, and issues a rotated token pair.

    Args:
        response: FastAPI response object for setting the new refresh cookie.
        db: Async database session.
        refresh_token: Refresh token read from the cookie by FastAPI.

    Returns:
        AuthResponse with user info and new access token. New refresh token set as cookie.

    Raises:
        HTTPException 401: Missing, invalid, or expired refresh token, or user not found.
    """
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    try:
        payload = jwt.decode(refresh_token, _refresh_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER)
    except jwt.PyJWTError:
        _clear_refresh_cookie(response)
        # from None suppresses exception chaining to keep logs clean and avoid leaking JWT internals
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token") from None

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Rotate both tokens
    new_access = create_access_token(user.id)
    _set_refresh_cookie(response, create_refresh_token(user.id))
    return AuthResponse(user=UserInfo.model_validate(user), access_token=new_access)


@router.post("/logout")
async def logout_route(response: Response):
    """Clear the refresh token cookie to end the user's session.

    Args:
        response: FastAPI response object.

    Returns:
        Confirmation message.
    """
    _clear_refresh_cookie(response)
    return {"detail": "Logged out"}
