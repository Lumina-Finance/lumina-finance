"""Auth routes"""
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_authenticated_user, get_current_session_id, get_current_user
from app.models.user import User
from app.routes.auth.jwks_helpers import build_jwks_response
from app.routes.auth.logout_helpers import logout_auth_session
from app.routes.auth.passkeys import router as passkeys_router
from app.routes.auth.refresh_helpers import refresh_auth_tokens
from app.routes.auth.token_helpers import (
    complete_mfa_challenge,
    issue_and_store_tokens,
)
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    DisableTotpRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MfaRequiredResponse,
    MfaVerifyRequest,
    RecoveryCodesResponse,
    RegenerateRecoveryCodesRequest,
    ResetPasswordRequest,
    SignupRequest,
    TotpConfirmRequest,
    TotpSetupResponse,
    TotpStatusResponse,
)
from app.services.auth import (
    begin_totp_setup,
    change_password,
    complete_totp_enrollment,
    confirm_recovery_codes,
    confirm_totp_enrollment,
    disable_two_factor,
    is_passkey_registered,
    is_totp_enabled,
    issue_mfa_challenge,
    login,
    prune_stale_passkey_staging,
    regenerate_recovery_codes,
    request_password_reset,
    reset_password,
    signup,
)
from app.services.auth.account_lockout import get_password_credential, reset_failed_attempts

_security = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/auth", tags=["auth"])

# Passkey registration and management share the /auth prefix through their own router
router.include_router(passkeys_router)


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


@router.post("/login", response_model=AuthResponse | MfaRequiredResponse)
async def login_route(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Authenticate a user, issuing tokens or a second-factor challenge

    Args:
        data: Login payload with email and password
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with tokens, or a challenge when a second factor is required

    Raises:
        HTTPException: Credentials are invalid or the account is locked
    """
    user = await login(db, data)

    # Login is the ordinary action that sweeps a passkey setup the user never finished, since there is
    # no reliable signal that they abandoned it
    await prune_stale_passkey_staging(db, user.id)
    await db.commit()

    # Any confirmed second factor, or a pending re-enrolment whose only key is a recovery code, holds
    # back tokens until the verify endpoint clears the challenge. A passkey is the preferred factor when
    # present, with a recovery code the only path once no factor remains
    totp_enabled = await is_totp_enabled(db, user.id)
    passkey_available = await is_passkey_registered(db, user.id)
    if totp_enabled or passkey_available or user.totp_reenrollment_required:
        challenge_token = await issue_mfa_challenge(db, user.id)
        return MfaRequiredResponse(
            mfa_token=challenge_token,
            totp_enabled=totp_enabled,
            passkey_available=passkey_available,
            recovery_only=not totp_enabled and not passkey_available,
        )

    # A login with no second factor is complete here, so clear the shared lockout counter
    credential = await get_password_credential(db, user.id)
    if credential is not None:
        await reset_failed_attempts(db, credential)

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


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password_route(
    data: ResetPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set a new password from a valid reset token

    Args:
        data: Reset payload with the emailed token and the new password
        db: Active database session

    Raises:
        HTTPException: The token is invalid, used, or expired
    """
    await reset_password(db, data.token, data.new_password)


@router.get("/2fa/status", response_model=TotpStatusResponse)
async def totp_status_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Report whether the authenticated user has two-factor enabled

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        Whether a confirmed TOTP credential exists
    """
    return TotpStatusResponse(totp_enabled=await is_totp_enabled(db, user.id))


@router.post("/2fa/setup", response_model=TotpSetupResponse)
async def setup_totp_route(
    user: Annotated[User, Depends(get_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Begin TOTP enrolment for the authenticated user

    Uses the permissive resolver so a recovery-code login can fetch a fresh secret to re-enrol

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The secret and provisioning URI for the authenticator app

    Raises:
        HTTPException: Two-factor authentication is already enabled
    """
    secret, provisioning_uri = await begin_totp_setup(db, user.id, user.email)
    return TotpSetupResponse(secret=secret, provisioning_uri=provisioning_uri)


@router.post("/2fa/confirm", response_model=RecoveryCodesResponse)
async def confirm_totp_route(
    data: TotpConfirmRequest,
    user: Annotated[User, Depends(get_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify the enrolment code and return the recovery codes, with two-factor still pending

    Two-factor is only turned on by the complete route once the user acknowledges these codes. The
    permissive resolver lets a recovery-code login run this same flow to re-enrol

    Args:
        data: Authenticator code confirming enrolment
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The one-time recovery codes to show once

    Raises:
        HTTPException: No pending setup exists or the code is invalid
    """
    codes = await confirm_totp_enrollment(db, user.id, data.code)
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post("/2fa/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_totp_route(
    user: Annotated[User, Depends(get_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Turn on two-factor after the user has saved their recovery codes

    The permissive resolver lets a recovery-code login finish re-enrolment here, which also lifts the
    restriction

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: Enrolment was not confirmed first, or there is no pending setup
    """
    await complete_totp_enrollment(db, user.id)


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_totp_route(
    data: DisableTotpRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Disable two-factor authentication after step-up reauthentication

    Args:
        data: Password and a current second factor
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: Two-factor is not enabled, or the step-up check fails
    """
    await disable_two_factor(db, user, data.password, data.code)


@router.post("/2fa/recovery-codes", response_model=RecoveryCodesResponse)
async def regenerate_recovery_codes_route(
    data: RegenerateRecoveryCodesRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Stage a fresh recovery code batch after step-up reauthentication

    The current codes keep working until the user acknowledges these through the confirm route

    Args:
        data: Password and a current authenticator code
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The fresh recovery codes to show once

    Raises:
        HTTPException: Two-factor is not enabled, or the step-up check fails
    """
    codes = await regenerate_recovery_codes(db, user, data.password, data.code)
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post("/2fa/recovery-codes/confirm", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_recovery_codes_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Activate a staged recovery code batch once the user has saved it

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: There is no staged batch to confirm
    """
    await confirm_recovery_codes(db, user.id)


@router.post("/2fa/verify", response_model=AuthResponse)
async def verify_totp_route(
    data: MfaVerifyRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Complete login by verifying the second factor and issuing a token pair

    Args:
        data: Challenge token and the authenticator code
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with user info and access token

    Raises:
        HTTPException: The challenge or the code does not verify
    """
    user = await complete_mfa_challenge(db, data.mfa_token, data.code)
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
