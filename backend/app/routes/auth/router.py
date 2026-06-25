"""Auth routes"""
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_session_id, get_current_user
from app.models.user import User
from app.routes.auth.jwks_helpers import build_jwks_response
from app.routes.auth.logout_helpers import logout_auth_session
from app.routes.auth.refresh_helpers import refresh_auth_tokens
from app.routes.auth.token_helpers import (
    issue_and_store_tokens,
)
from app.schemas.auth import AuthResponse, ChangePasswordRequest, ForgotPasswordRequest, LoginRequest, SignupRequest
from app.services.auth import change_password, login, request_password_reset, signup

_security = HTTPBearer(auto_error=False)

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


@router.patch("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password_route(
    data: ChangePasswordRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Change the authenticated user's password

    Args:
        data: Current and new password payload
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: The current password is incorrect
    """
    # get_current_user has already resolved, so the session id is set for this request
    current_session_id = get_current_session_id()
    await change_password(db, user, current_session_id, data)


@router.post("/password/forgot", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password_route(
    data: ForgotPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Send a password reset link when the email matches an account

    The response is always 204 so the endpoint never reveals whether an email is registered

    Args:
        data: Forgot-password payload with the account email
        db: Active database session
    """
    await request_password_reset(db, data.email)


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
    auth_response = await refresh_auth_tokens(db, request, response, refresh_token)
    return auth_response


@router.post("/logout")
async def logout_route(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)] = None,
    refresh_token: str | None = Cookie(None),
):
    """Revoke the caller's active auth session

    Invalid or missing tokens are ignored because logout is best-effort and
    still clears the refresh cookie

    Args:
        response: FastAPI response object
        db: Active database session
        credentials: Optional bearer token from the Authorization header
        refresh_token: Optional refresh token read from the cookie by FastAPI

    Returns:
        Logout confirmation
    """
    access_token = credentials.credentials if credentials else None
    logout_response = await logout_auth_session(db, response, access_token, refresh_token)
    return logout_response


@router.get("/.well-known/jwks.json")
async def jwks():
    """Publish public keys for external token verification

    Returns:
        JWKS document containing access and refresh public keys
    """
    jwks_response = build_jwks_response()
    return jwks_response
