"""OIDC sign-in and provider linking routes"""

import uuid
from typing import Annotated

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.oidc import OidcIdentity, OidcProvider
from app.models.user import User
from app.routes.auth.cookie_helpers import (
    OIDC_BINDING_COOKIE_KEY,
    clear_oidc_login_binding_cookie,
    set_oidc_login_binding_cookie,
    set_set_password_authz_cookie,
)
from app.routes.auth.token_helpers import decode_oidc_onboarding_token, issue_and_store_tokens
from app.schemas.auth import (
    AuthResponse,
    OidcAuthorizeResponse,
    OidcCallbackRequest,
    OidcIdentitiesResponse,
    OidcIdentitySummary,
    OidcOnboardingResponse,
    OidcProviderInfo,
    OidcProvidersResponse,
    OidcReauthRequest,
    OidcSignupRequest,
    StepUpRequest,
)
from app.services.auth import (
    OidcOnboardingClaims,
    begin_oidc_link,
    begin_oidc_reauth,
    begin_oidc_sign_in,
    complete_oidc_link,
    complete_oidc_reauth,
    complete_oidc_sign_in,
    complete_oidc_signup,
    create_oidc_onboarding_token,
    create_set_password_authz_token,
    get_enabled_oidc_provider_by_slug,
    is_oidc_provider_linked,
    list_enabled_oidc_providers,
    list_oidc_identities,
    unlink_oidc_identity,
)
from app.services.auth.account_lockout import get_password_credential
from app.services.auth.step_up import verify_sensitive_action_step_up

router = APIRouter(prefix="/oidc", tags=["auth"])


def _build_identity_summary(identity: OidcIdentity, provider: OidcProvider) -> OidcIdentitySummary:
    """Return the settings-list summary for a linked identity and its provider"""
    return OidcIdentitySummary(
        id=identity.id,
        provider_slug=provider.slug,
        provider_display_name=provider.display_name,
        email=identity.email,
        created_at=identity.created_at,
        last_login_at=identity.last_login_at,
    )


@router.get("/providers", response_model=OidcProvidersResponse)
async def list_oidc_providers_route(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List the enabled single sign-on providers for the login page

    Args:
        db: Active database session

    Returns:
        The providers whose sign-in buttons the login page offers
    """
    providers = await list_enabled_oidc_providers(db)
    return OidcProvidersResponse(providers=[OidcProviderInfo.model_validate(provider) for provider in providers])


@router.post("/{slug}/authorize", response_model=OidcAuthorizeResponse)
async def authorize_oidc_route(
    slug: str,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Start a sign-in with the named provider and return the URL to redirect the browser to

    A binding cookie is set alongside, so only the browser that started the flow can
    complete the callback, which is what the OAuth state parameter guards against

    Args:
        slug: Provider picked on the login page
        request: FastAPI request object
        response: FastAPI response object for setting the binding cookie
        db: Active database session

    Returns:
        The provider's authorization URL bound to a stored single-use roundtrip

    Raises:
        HTTPException: The provider is unknown or disabled, or discovery fails
    """
    provider = await get_enabled_oidc_provider_by_slug(db, slug)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown sign-in provider")

    authorization_url, binding_token = await begin_oidc_sign_in(db, provider)
    set_oidc_login_binding_cookie(request, response, binding_token)
    return OidcAuthorizeResponse(authorization_url=authorization_url)


@router.post("/callback", response_model=AuthResponse | OidcOnboardingResponse)
async def oidc_callback_route(
    data: OidcCallbackRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    oidc_login_binding: Annotated[str | None, Cookie(alias=OIDC_BINDING_COOKIE_KEY)] = None,
):
    """Finish a provider sign-in, issuing tokens or the onboarding step for a new user

    A provider sign-in stands in for both factors like a passkey does, since any second
    factor is the provider's to enforce, so a resolved account signs in with no local
    challenge. The provider is identified by the stored roundtrip the state names, which
    is why the route carries no provider slug. The binding cookie proves the callback runs
    in the browser that started the flow, and is cleared once spent

    Args:
        data: Code and state the provider sent to the callback page
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session
        oidc_login_binding: Binding secret read from the login cookie

    Returns:
        Auth response with tokens, or the onboarding token when profile fields are needed

    Raises:
        HTTPException: The roundtrip, binding, exchange, or token does not verify, or the
            email collides with an account it cannot be linked to
    """
    # The binding cookie is single-use, so clear it whatever the outcome of this callback
    clear_oidc_login_binding_cookie(response)

    result = await complete_oidc_sign_in(db, data.code, data.state, oidc_login_binding)

    if isinstance(result, OidcOnboardingClaims):
        onboarding_token = create_oidc_onboarding_token(
            provider_slug=result.provider_slug,
            subject=result.subject,
            email=result.email,
            email_verified=result.email_verified,
            first_name=result.first_name,
            last_name=result.last_name,
        )
        return OidcOnboardingResponse(
            onboarding_token=onboarding_token,
            email=result.email,
            first_name=result.first_name,
            last_name=result.last_name,
        )

    return await issue_and_store_tokens(db, request, response, result)


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def oidc_signup_route(
    data: OidcSignupRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create the account a first-time provider sign-in onboarded and issue a token pair

    Args:
        data: Onboarding token with the profile fields collected at completion
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        db: Active database session

    Returns:
        Auth response with user info and access token

    Raises:
        HTTPException: The onboarding token is invalid or expired, or signup checks fail
    """
    onboarding = _decode_onboarding_claims(data.onboarding_token)
    user = await complete_oidc_signup(
        db,
        onboarding,
        first_name=data.first_name,
        last_name=data.last_name,
        tz=data.tz,
        base_currency=data.base_currency,
    )
    return await issue_and_store_tokens(db, request, response, user)


@router.get("/identities", response_model=OidcIdentitiesResponse)
async def list_oidc_identities_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List the account's linked providers for the security settings

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The linked identities and whether the account has a password for step-up actions
    """
    identity_pairs = await list_oidc_identities(db, user)
    has_password = await get_password_credential(db, user.id) is not None
    return OidcIdentitiesResponse(
        identities=[_build_identity_summary(identity, provider) for identity, provider in identity_pairs],
        has_password=has_password,
    )


@router.post("/{slug}/link", response_model=OidcAuthorizeResponse)
async def link_oidc_route(
    slug: str,
    data: StepUpRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Reauthorize, then start linking a provider to the signed-in account

    The step-up runs before the roundtrip is stored, so the browser is never sent to the
    provider until the current password, and factor when one is enrolled, have verified

    Args:
        slug: Provider being linked
        data: Password and a current second factor when one is enrolled
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The provider's authorization URL bound to a stored single-use link roundtrip

    Raises:
        HTTPException: The provider is unknown, the step-up fails, or discovery fails
    """
    provider = await get_enabled_oidc_provider_by_slug(db, slug)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown sign-in provider")

    await verify_sensitive_action_step_up(db, user, data.password, code=data.code, passkey=data.passkey)
    authorization_url = await begin_oidc_link(db, user, provider)
    return OidcAuthorizeResponse(authorization_url=authorization_url)


@router.post("/link/callback", response_model=OidcIdentitySummary)
async def oidc_link_callback_route(
    data: OidcCallbackRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Finish linking a provider to the signed-in account

    Args:
        data: Code and state the provider sent to the callback page
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The newly linked identity for the settings list

    Raises:
        HTTPException: The roundtrip, exchange, or token does not verify, the roundtrip
            belongs to another account, or the subject is already linked
    """
    identity, provider = await complete_oidc_link(db, user, data.code, data.state)
    return _build_identity_summary(identity, provider)


@router.post("/reauth", response_model=OidcAuthorizeResponse)
async def reauth_oidc_route(
    data: OidcReauthRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Start a provider reauth so a passwordless account can authorize setting its first password

    Only an account with no password uses this, since an account with a password steps up with it
    instead. The chosen provider must already be linked, so the reauth re-proves an identity the
    account owns

    Args:
        data: The linked provider slug to re-authenticate through
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The provider's authorization URL bound to a stored single-use reauth roundtrip

    Raises:
        HTTPException: The account already has a password, or the provider is unknown or not linked
    """
    if await get_password_credential(db, user.id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account already has a password")

    provider = await get_enabled_oidc_provider_by_slug(db, data.slug)
    if provider is None or not await is_oidc_provider_linked(db, user, provider.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Linked sign-in not found")

    authorization_url = await begin_oidc_reauth(db, user, provider)
    return OidcAuthorizeResponse(authorization_url=authorization_url)


@router.post("/reauth/callback", status_code=status.HTTP_204_NO_CONTENT)
async def oidc_reauth_callback_route(
    data: OidcCallbackRequest,
    request: Request,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Finish a provider reauth and hand back a short-lived set-password authorization

    The authorization rides in an httpOnly cookie so the set-password request that follows proves a
    fresh re-authentication rather than just a live session

    Args:
        data: Code and state the provider sent to the callback page
        request: FastAPI request object
        response: FastAPI response object for setting the authorization cookie
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: The roundtrip, exchange, or token does not verify, or the identity is not
            linked to this account
    """
    await complete_oidc_reauth(db, user, data.code, data.state)
    set_set_password_authz_cookie(request, response, create_set_password_authz_token(user.id))


@router.post("/identities/{identity_id}/remove", status_code=status.HTTP_204_NO_CONTENT)
async def remove_oidc_identity_route(
    identity_id: uuid.UUID,
    data: StepUpRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove a linked provider after step-up reauthentication

    Args:
        identity_id: Identity row being removed
        data: Password and a current second factor when one is enrolled
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: The step-up fails, the identity is not the user's, or removing it
            would leave the account with no way to sign in
    """
    await unlink_oidc_identity(db, user, identity_id, data.password, code=data.code, passkey=data.passkey)


def _decode_onboarding_claims(onboarding_token: str) -> OidcOnboardingClaims:
    """Return the verified claims an onboarding token carries

    Args:
        onboarding_token: Encoded onboarding JWT from the completion form

    Returns:
        The verified provider claims

    Raises:
        HTTPException: The token cannot be decoded or verified
    """
    try:
        payload = decode_oidc_onboarding_token(onboarding_token)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired onboarding token"
        ) from None

    return OidcOnboardingClaims(
        provider_slug=payload["provider_slug"],
        subject=payload["sub"],
        email=payload["email"],
        email_verified=bool(payload.get("email_verified")),
        first_name=payload.get("first_name") or "",
        last_name=payload.get("last_name"),
    )
