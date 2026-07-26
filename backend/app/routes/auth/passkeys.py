"""Passkey registration and management routes"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.webauthn import WEBAUTHN_RP_ID
from app.database import get_db
from app.dependencies import get_authenticated_user, get_current_user
from app.models.user import User
from app.routes.auth.token_helpers import (
    complete_mfa_challenge_with_passkey,
    get_mfa_challenge_user_id,
    issue_and_store_tokens,
)
from app.schemas.auth import (
    AuthResponse,
    PasskeyAuthenticationRequest,
    PasskeyConfigResponse,
    PasskeyMfaOptionsRequest,
    PasskeyMfaVerifyRequest,
    PasskeyRegisterRequest,
    PasskeyRegisterResponse,
    PasskeyRegistrationOptionsRequest,
    PasskeyRenameRequest,
    PasskeyResetVerifyRequest,
    PasskeySummary,
    StepUpRequest,
)
from app.services.auth import (
    MFA_PURPOSE_LOGIN,
    MFA_PURPOSE_PASSWORD_RESET,
    authorize_factor_addition,
    build_passkey_authentication_options,
    build_passkey_registration_options,
    build_passkey_second_factor_options,
    complete_password_reset,
    confirm_passkey_registration,
    ensure_reset_token_active,
    list_passkeys,
    register_passkey,
    remove_passkey_with_step_up,
    rename_passkey,
    verify_passkey_authentication,
)

# Browsers reject ceremonies whose options are not raw WebAuthn JSON, so they are returned untouched
_OPTIONS_MEDIA_TYPE = "application/json"

router = APIRouter(prefix="/passkeys", tags=["auth"])


@router.get("/config", response_model=PasskeyConfigResponse)
async def passkey_config_route():
    """Report the relying party id the client checks the current origin against

    Public because the login screen needs it before any user is known

    Returns:
        The configured relying party id
    """
    return PasskeyConfigResponse(rp_id=WEBAUTHN_RP_ID)


@router.post("/authenticate/options")
async def passkey_authentication_options_route(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Begin a passwordless sign-in by returning ceremony options for the browser

    Public and usernameless, so the browser offers any passkey registered for this site

    Args:
        db: Active database session

    Returns:
        WebAuthn authentication options as raw JSON
    """
    options_json = await build_passkey_authentication_options(db)
    return Response(content=options_json, media_type=_OPTIONS_MEDIA_TYPE)


@router.post("/authenticate", response_model=AuthResponse)
async def authenticate_passkey_route(
    data: PasskeyAuthenticationRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify a sign-in assertion and issue a token pair

    A user-verified passkey stands in for both factors, so a verified assertion completes login with
    no second-factor step

    Args:
        data: The browser's assertion response
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with user info and access token

    Raises:
        HTTPException: The challenge, passkey, or assertion does not verify
    """
    user = await verify_passkey_authentication(db, data.credential)
    return await issue_and_store_tokens(db, request, response, user)


@router.post("/mfa/options")
async def passkey_second_factor_options_route(
    data: PasskeyMfaOptionsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Begin the passkey second-factor step for a login that passed its password

    The challenge token names the user, so their own passkeys are offered without a session

    Args:
        data: The login challenge token
        db: Active database session

    Returns:
        WebAuthn authentication options as raw JSON

    Raises:
        HTTPException: The challenge token is invalid or its challenge is spent or expired
    """
    user_id = await get_mfa_challenge_user_id(db, data.mfa_token, MFA_PURPOSE_LOGIN)
    options_json = await build_passkey_second_factor_options(db, user_id)
    return Response(content=options_json, media_type=_OPTIONS_MEDIA_TYPE)


@router.post("/mfa/verify", response_model=AuthResponse)
async def verify_passkey_second_factor_route(
    data: PasskeyMfaVerifyRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Complete a password login by verifying a passkey as the second factor and issuing tokens

    Args:
        data: The login challenge token and the passkey assertion
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with user info and access token

    Raises:
        HTTPException: The challenge or the assertion does not verify
    """
    user, _ = await complete_mfa_challenge_with_passkey(db, data.mfa_token, data.credential, MFA_PURPOSE_LOGIN)
    return await issue_and_store_tokens(db, request, response, user)


@router.post("/reset/options")
async def passkey_reset_factor_options_route(
    data: PasskeyMfaOptionsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Begin the passkey second-factor step for a reset that holds a valid emailed token

    The challenge token names the user, so their own passkeys are offered without a session

    Args:
        data: The reset challenge token
        db: Active database session

    Returns:
        WebAuthn authentication options as raw JSON

    Raises:
        HTTPException: The challenge token is invalid or its challenge is spent or expired
    """
    user_id = await get_mfa_challenge_user_id(db, data.mfa_token, MFA_PURPOSE_PASSWORD_RESET)
    options_json = await build_passkey_second_factor_options(db, user_id)
    return Response(content=options_json, media_type=_OPTIONS_MEDIA_TYPE)


@router.post("/reset/verify", status_code=status.HTTP_204_NO_CONTENT)
async def verify_passkey_reset_factor_route(
    data: PasskeyResetVerifyRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Complete a factor-gated password reset by verifying a passkey assertion

    Args:
        data: The reset payload with the emailed token, challenge token, assertion, and new password
        db: Active database session

    Raises:
        HTTPException: The token, challenge, or assertion does not verify, or the account is locked
    """
    # The challenge below is single use, so reject a dead reset token before it burns
    await ensure_reset_token_active(db, data.token)

    user, _ = await complete_mfa_challenge_with_passkey(db, data.mfa_token, data.credential, MFA_PURPOSE_PASSWORD_RESET)
    await complete_password_reset(db, user.id, data.token, data.new_password)


@router.get("", response_model=list[PasskeySummary])
async def list_passkeys_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List the authenticated user's registered passkeys

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The user's passkeys, newest first
    """
    return await list_passkeys(db, user.id)


@router.post("/step-up/options")
async def passkey_step_up_options_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Begin a passkey step-up for a sensitive two-factor change

    The user is already authenticated, so their own passkeys are offered to reauthorize an action such
    as disabling TOTP, removing a passkey, or regenerating recovery codes

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        WebAuthn authentication options as raw JSON
    """
    options_json = await build_passkey_second_factor_options(db, user.id)
    return Response(content=options_json, media_type=_OPTIONS_MEDIA_TYPE)


@router.post("/register/options")
async def passkey_registration_options_route(
    data: PasskeyRegistrationOptionsRequest,
    user: Annotated[User, Depends(get_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Reauthorize, then begin registration by returning ceremony options for the browser

    The step-up runs here rather than at the store step so the browser never runs a registration
    ceremony until the current factor verifies, and a wrong factor is refused before any passkey is
    created. The permissive resolver lets a recovery-code login re-establish a second factor with a
    passkey without stepping up

    Args:
        data: Reauthorization gating the ceremony, omitted only by a forced re-enrol
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        WebAuthn registration options as raw JSON

    Raises:
        HTTPException: Reauthentication is required and missing or fails
    """
    await authorize_factor_addition(db, user, data.step_up)
    options_json = await build_passkey_registration_options(db, user.id, user.email)
    return Response(content=options_json, media_type=_OPTIONS_MEDIA_TYPE)


@router.post("/register", response_model=PasskeyRegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_passkey_route(
    data: PasskeyRegisterRequest,
    user: Annotated[User, Depends(get_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify a finished registration ceremony and store the passkey

    A first passkey comes back with recovery codes and stays staged until they are confirmed, while a
    later passkey is active immediately with no codes. Reauthorization already happened at the options
    step that issued this ceremony's challenge, so a stored passkey has always cleared step-up. The
    permissive resolver lets a recovery-code login re-establish a second factor here, which also lifts
    the restriction

    Args:
        data: The browser's attestation response and the label to store it under
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The stored passkey and, for a first passkey, the recovery codes to save

    Raises:
        HTTPException: The challenge is unknown or expired, or the attestation fails to verify
    """
    passkey, recovery_codes = await register_passkey(db, user.id, data.credential, data.name)
    return PasskeyRegisterResponse(passkey=PasskeySummary.model_validate(passkey), recovery_codes=recovery_codes)


@router.post("/register/confirm", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_passkey_registration_route(
    user: Annotated[User, Depends(get_authenticated_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Activate a staged first passkey after its recovery codes have been saved

    Uses the permissive resolver so a recovery-code login that re-establishes with a passkey can finish
    here, which also lifts the restriction

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: No staged passkey with pending recovery codes is awaiting confirmation
    """
    await confirm_passkey_registration(db, user.id)


@router.patch("/{passkey_id}", response_model=PasskeySummary)
async def rename_passkey_route(
    passkey_id: uuid.UUID,
    data: PasskeyRenameRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Relabel one of the authenticated user's passkeys

    Args:
        passkey_id: Passkey to relabel
        data: The new label
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The updated passkey summary

    Raises:
        HTTPException: The passkey does not exist or belongs to another user
    """
    return await rename_passkey(db, user.id, passkey_id, data.name)


@router.post("/{passkey_id}/remove", status_code=status.HTTP_204_NO_CONTENT)
async def remove_passkey_route(
    passkey_id: uuid.UUID,
    data: StepUpRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete one of the authenticated user's passkeys after step-up reauthentication

    Args:
        passkey_id: Passkey to delete
        data: Password and a current second factor, a passkey assertion or a TOTP code
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: The passkey does not exist, or the step-up check fails
    """
    await remove_passkey_with_step_up(db, user, passkey_id, data.password, code=data.code, passkey=data.passkey)
