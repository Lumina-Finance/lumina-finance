"""Auth routes"""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_db, get_session_factory
from app.dependencies import get_authenticated_user, get_current_session_id, get_current_user
from app.models.user import User
from app.routes.auth.cookie_helpers import OIDC_REAUTH_STEPUP_COOKIE_KEY
from app.routes.auth.jwks_helpers import build_jwks_response
from app.routes.auth.logout_helpers import logout_auth_session
from app.routes.auth.oidc import router as oidc_router
from app.routes.auth.passkeys import router as passkeys_router
from app.routes.auth.refresh_helpers import refresh_auth_tokens
from app.routes.auth.token_helpers import (
    complete_mfa_challenge,
    issue_and_store_tokens,
    spend_reauth_stepup_proof,
)
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    ConfirmSignupRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MfaRequiredResponse,
    MfaVerifyRequest,
    RecoveryCodesResponse,
    RegistrationStatusResponse,
    ResetPasswordRequest,
    ResetPasswordVerifyRequest,
    SetPasswordRequest,
    SignupRequest,
    StepUpRequest,
    TotpConfirmRequest,
    TotpSetupRequest,
    TotpSetupResponse,
    TotpStatusResponse,
)
from app.services.auth import (
    MFA_PURPOSE_LOGIN,
    MFA_PURPOSE_PASSWORD_RESET,
    SECOND_FACTOR_RECOVERY_CODE,
    authorize_factor_addition,
    begin_password_reset,
    begin_totp_setup,
    change_password,
    complete_password_reset,
    complete_totp_enrollment,
    confirm_recovery_codes,
    confirm_signup,
    confirm_totp_enrollment,
    disable_two_factor,
    ensure_reset_token_active,
    is_passkey_registered,
    is_registration_open,
    is_totp_enabled,
    issue_mfa_challenge,
    login,
    prune_stale_factor_staging,
    regenerate_recovery_codes,
    request_password_reset,
    request_signup,
    set_first_password,
)
from app.services.auth.account_lockout import reset_failed_attempts

_security = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/auth", tags=["auth"])

# Passkey registration and management share the /auth prefix through their own router
router.include_router(passkeys_router)

# OIDC sign-in shares the /auth prefix through its own router
router.include_router(oidc_router)


@router.post("/signup", status_code=status.HTTP_204_NO_CONTENT)
async def signup_route(
    data: SignupRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
    session_factory: Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)],
):
    """Email a confirmation link to a new address, and send an address that has an account nothing

    The response is always 204 so the endpoint never reveals whether an email is registered, and the
    email goes out after it so the response takes as long either way. No account exists until the
    link is confirmed

    Args:
        data: Signup payload with email, name, timezone, and currency
        db: Active database session
        background_tasks: Runs the send once the response is out
        session_factory: Opens the session that releases the send cap after a failed send

    Raises:
        HTTPException: Registration is closed or the base currency is invalid
    """
    await request_signup(db, data, background_tasks, session_factory)


@router.post("/signup/confirm", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def confirm_signup_route(
    data: ConfirmSignupRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create the account an emailed link was sent for, with the chosen password, and issue a token pair

    Args:
        data: Confirmation token with the password the person chose
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with user info and access token

    Raises:
        HTTPException: The link is invalid, expired or already used, or registration is closed
    """
    user = await confirm_signup(db, data.token, data.new_password)
    return await issue_and_store_tokens(db, request, response, user)


@router.get("/registration", response_model=RegistrationStatusResponse)
async def registration_status_route():
    """Report whether new accounts can be created, so the login page can hide sign-up"""
    return RegistrationStatusResponse(enabled=is_registration_open())


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

    # Login is the ordinary action that sweeps factor setup the user never finished, since there is
    # no reliable signal that they abandoned it
    await prune_stale_factor_staging(db, user.id)
    await db.commit()

    # Any confirmed second factor, or a pending re-enrolment whose only key is a recovery code, holds
    # back tokens until the verify endpoint clears the challenge. A passkey is the preferred factor when
    # present, with a recovery code the only path once no factor remains
    totp_enabled = await is_totp_enabled(db, user.id)
    passkey_available = await is_passkey_registered(db, user.id)
    if totp_enabled or passkey_available or user.second_factor_reenrollment_required:
        challenge_token = await issue_mfa_challenge(db, user.id, MFA_PURPOSE_LOGIN)
        return MfaRequiredResponse(
            mfa_token=challenge_token,
            totp_enabled=totp_enabled,
            passkey_available=passkey_available,
            recovery_only=not totp_enabled and not passkey_available,
        )

    # A login with no second factor is complete here, so clear the shared lockout counter
    await reset_failed_attempts(db, user.email)
    await db.commit()

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


@router.post("/password/set", status_code=status.HTTP_204_NO_CONTENT)
async def set_password_route(
    data: SetPasswordRequest,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    oidc_reauth_stepup: Annotated[str | None, Cookie(alias=OIDC_REAUTH_STEPUP_COOKIE_KEY)] = None,
):
    """Set the first password for an account authorized by a provider reauth

    The authorization cookie proves a fresh re-authentication, so a live session alone cannot add a
    password. Setting one wipes every other session like a password change, and the cookie is spent

    Args:
        data: New password payload
        response: FastAPI response object for clearing the authorization cookie
        user: Authenticated user resolved from the access token
        db: Active database session
        oidc_reauth_stepup: Authorization token read from the reauth cookie

    Raises:
        HTTPException: The authorization is missing, invalid, or for another account, or the
            account already has a password
    """
    # The proof is bound to the account that reauthenticated, so it cannot set a password on any other
    # account even if the cookie is somehow presented on a different session, and it is spent whatever
    # the outcome
    await spend_reauth_stepup_proof(
        user.id,
        response,
        oidc_reauth_stepup,
        lambda: set_first_password(db, user, get_current_session_id(), data.new_password),
    )


@router.post("/password/forgot", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password_route(
    data: ForgotPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    session_factory: Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)],
    background_tasks: BackgroundTasks,
):
    """Send a password reset link when the email matches an account

    The response is always 204 so the endpoint never reveals whether an email is registered, and the
    email goes out after it so the response takes as long either way

    Args:
        data: Forgot-password payload with the account email
        db: Active database session
        session_factory: Opens the session the send uses after the response
        background_tasks: Runs the send once the response is out
    """
    await request_password_reset(db, data.email, background_tasks, session_factory)


@router.post("/password/reset", response_model=MfaRequiredResponse | None)
async def reset_password_route(
    data: ResetPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set a new password from a valid reset token, or challenge for the second factor

    An account with an active second factor must verify it before the password changes, so the
    reset link alone is never enough to take over a protected account

    Args:
        data: Reset payload with the emailed token and the new password
        db: Active database session

    Returns:
        A challenge when a second factor is required, otherwise an empty 204

    Raises:
        HTTPException: The token is invalid, used, or expired
    """
    challenge = await begin_password_reset(db, data.token, data.new_password)
    if challenge is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return MfaRequiredResponse(
        mfa_token=challenge.mfa_token,
        totp_enabled=challenge.totp_enabled,
        passkey_available=challenge.passkey_available,
        recovery_only=not challenge.totp_enabled and not challenge.passkey_available,
    )


@router.post("/password/reset/verify", response_model=AuthResponse | None)
async def reset_password_verify_route(
    data: ResetPasswordVerifyRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Complete a factor-gated password reset with an authenticator or recovery code

    A recovery code is treated as lost authenticators, exactly like at login: every factor is
    wiped, re-enrolment is required, and the response carries the restricted session that can only
    re-establish a factor. A routine code just finishes the reset

    Args:
        data: Reset payload with the emailed token, challenge token, code, and new password
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        The restricted session after a recovery code, otherwise an empty 204

    Raises:
        HTTPException: The token, challenge, or code does not verify, or the account is locked
    """
    # The challenge below is single use, so reject a dead reset token before it burns
    await ensure_reset_token_active(db, data.token)

    user, factor_kind = await complete_mfa_challenge(db, data.mfa_token, data.code, MFA_PURPOSE_PASSWORD_RESET)
    await complete_password_reset(db, user.id, data.token, data.new_password)

    if factor_kind == SECOND_FACTOR_RECOVERY_CODE:
        return await issue_and_store_tokens(db, request, response, user)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    data: TotpSetupRequest,
    user: Annotated[User, Depends(get_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Reauthorize, then begin TOTP enrolment for the authenticated user

    The step-up runs here rather than at confirm so a wrong current factor is refused before the QR is
    shown, and its prompt can stay open to retry without a half-built enrolment behind it. The permissive
    resolver lets a recovery-code login fetch a fresh secret to re-enrol without stepping up

    Args:
        data: Reauthorization gating enrolment, omitted only by a forced re-enrol
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The secret and provisioning URI for the authenticator app

    Raises:
        HTTPException: Reauthentication is required and missing or fails, or two-factor is already enabled
    """
    await authorize_factor_addition(db, user, data.step_up)
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
    data: StepUpRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Disable two-factor authentication after step-up reauthentication

    Args:
        data: Password and a current second factor, a passkey assertion or a TOTP code
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: Two-factor is not enabled, or the step-up check fails
    """
    await disable_two_factor(db, user, data.password, code=data.code, passkey=data.passkey)


@router.post("/2fa/recovery-codes", response_model=RecoveryCodesResponse)
async def regenerate_recovery_codes_route(
    data: StepUpRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Stage a fresh recovery code batch after step-up reauthentication

    The current codes keep working until the user acknowledges these through the confirm route

    Args:
        data: Password and a current second factor, a passkey assertion or a TOTP code
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The fresh recovery codes to show once

    Raises:
        HTTPException: No second factor is enabled, or the step-up check fails
    """
    codes = await regenerate_recovery_codes(db, user, data.password, code=data.code, passkey=data.passkey)
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
    user, _ = await complete_mfa_challenge(db, data.mfa_token, data.code, MFA_PURPOSE_LOGIN)
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
