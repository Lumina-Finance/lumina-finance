from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import JWT_REFRESH_TOKEN_EXPIRE_HOURS
from app.database import get_db
from app.schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserInfo
from app.services.auth import create_access_token, create_refresh_token, login, signup

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
