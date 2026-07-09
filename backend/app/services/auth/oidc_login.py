"""OIDC sign-in orchestration and account resolution service"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import APP_URL, OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS
from app.database import current_user_id_ctx
from app.encryption import decrypt
from app.models.auth import AuthIdentity
from app.models.base import AuthProvider
from app.models.oidc import OidcAuthorizationRequest, OidcIdentity, OidcProvider
from app.models.user import User
from app.services.auth.account_lockout import get_password_credential
from app.services.auth.oidc_client import (
    build_authorization_url,
    exchange_authorization_code,
    fetch_userinfo,
    generate_pkce_pair,
    get_provider_metadata,
    verify_provider_id_token,
)
from app.services.auth.oidc_providers import get_enabled_oidc_provider_by_id
from app.services.auth.signup import reject_missing_base_currency, reject_registered_email
from app.services.auth.step_up import verify_sensitive_action_step_up
from app.services.auth.token_hashing import hash_token
from app.services.auth.user_lookup import find_user_id_by_email
from app.services.auth.webauthn import is_passkey_registered

# The one callback path every provider registers, appended to the public app origin
OIDC_REDIRECT_PATH = "/auth/oidc/callback"

# Machine-readable conflict code the client matches to offer a password sign-in instead
OIDC_EMAIL_CONFLICT_CODE = "email_already_registered"

# A roundtrip only completes within the flow that started it, so a link roundtrip can
# never complete a login and vice versa
OIDC_PURPOSE_LOGIN = "login"
OIDC_PURPOSE_LINK = "link"


@dataclass(frozen=True)
class OidcOnboardingClaims:
    """Verified provider claims carried from a sign-in to the signup completion step"""

    provider_slug: str
    subject: str
    email: str
    email_verified: bool
    first_name: str
    last_name: str | None


def get_oidc_redirect_uri() -> str:
    """Return the callback URL registered with every provider"""
    return f"{APP_URL}{OIDC_REDIRECT_PATH}"


async def delete_expired_oidc_authorization_requests(db: AsyncSession) -> None:
    """Delete pending sign-in roundtrips whose expiry has passed

    Args:
        db: Active database session
    """
    expired_delete_query = delete(OidcAuthorizationRequest).where(
        OidcAuthorizationRequest.expires_at < sa_func.now()
    )

    # Abandoned roundtrips are never cleaned up otherwise, so prune them opportunistically
    await db.execute(expired_delete_query)


async def begin_oidc_sign_in(db: AsyncSession, provider: OidcProvider) -> tuple[str, str]:
    """Start a sign-in roundtrip and return the provider URL and the browser binding secret

    Args:
        db: Active database session
        provider: Enabled provider the user picked

    Returns:
        The provider's authorization URL and the binding secret the callback must present

    Raises:
        HTTPException: The provider's discovery document cannot be fetched
    """
    # The binding secret is handed to the browser as a cookie and its hash is stored, so the
    # callback proves it runs in the same browser that started the flow
    binding_token = secrets.token_urlsafe(32)
    authorization_url = await _begin_authorization(
        db, provider, OIDC_PURPOSE_LOGIN, browser_binding_hash=hash_token(binding_token)
    )
    return authorization_url, binding_token


async def _begin_authorization(
    db: AsyncSession,
    provider: OidcProvider,
    purpose: str,
    user_id: uuid.UUID | None = None,
    browser_binding_hash: str | None = None,
) -> str:
    """Store a single-use roundtrip for a purpose and return the provider redirect URL

    Args:
        db: Active database session
        provider: Enabled provider the roundtrip goes to
        purpose: Flow the roundtrip is scoped to
        user_id: Signed-in account a link roundtrip was authorized for
        browser_binding_hash: Hash of the login binding secret, set only for a login roundtrip

    Returns:
        The provider's authorization URL bound to the stored roundtrip

    Raises:
        HTTPException: The provider's discovery document cannot be fetched
    """
    metadata = await get_provider_metadata(provider.issuer)

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    code_verifier, code_challenge = generate_pkce_pair()

    await delete_expired_oidc_authorization_requests(db)
    db.add(
        OidcAuthorizationRequest(
            state_hash=hash_token(state),
            nonce=nonce,
            browser_binding_hash=browser_binding_hash,
            code_verifier=code_verifier,
            provider_id=provider.id,
            purpose=purpose,
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(seconds=OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS),
        )
    )
    await db.commit()

    return build_authorization_url(
        metadata,
        client_id=provider.client_id,
        scopes=provider.scopes,
        redirect_uri=get_oidc_redirect_uri(),
        state=state,
        nonce=nonce,
        code_challenge=code_challenge,
    )


async def complete_oidc_sign_in(
    db: AsyncSession, code: str, state: str, browser_binding_token: str | None
) -> User | OidcOnboardingClaims:
    """Finish a sign-in roundtrip and resolve which account it belongs to

    The stored roundtrip is consumed and committed before the provider is contacted, so a
    replayed callback finds it already spent. The binding secret is verified first, so a
    stolen state and code cannot complete a login in a browser that never started it.
    Resolution then runs in order: a known provider subject signs in, an email matching an
    existing account is refused so it can be linked from settings under step-up instead,
    and anything else onboards a new user

    Args:
        db: Active database session
        code: Authorization code the provider sent to the callback
        state: State value the provider echoed back
        browser_binding_token: Secret read from the login binding cookie

    Returns:
        The signed-in user, or the verified claims the signup completion step needs

    Raises:
        HTTPException: The roundtrip is unknown or expired, the binding secret is missing
            or wrong, the provider rejects the exchange, the token does not verify, or the
            email collides unverified
    """
    request_row = await _consume_authorization_request(db, state, OIDC_PURPOSE_LOGIN)

    # The roundtrip is spent above, so a wrong or missing binding secret fails the login and
    # forces a fresh sign-in rather than letting a stolen state and code through
    expected_binding_hash = request_row.browser_binding_hash
    if expected_binding_hash is None or browser_binding_token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")
    if not secrets.compare_digest(expected_binding_hash, hash_token(browser_binding_token)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    provider = await get_enabled_oidc_provider_by_id(db, request_row.provider_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    metadata = await get_provider_metadata(provider.issuer)
    token_response = await exchange_authorization_code(
        metadata,
        client_id=provider.client_id,
        client_secret=decrypt(provider.client_secret_encrypted),
        code=code,
        code_verifier=request_row.code_verifier,
        redirect_uri=get_oidc_redirect_uri(),
    )
    claims = await verify_provider_id_token(
        token_response["id_token"], metadata, provider.client_id, request_row.nonce
    )

    subject: str = claims["sub"]

    # A provider that keeps profile claims out of the ID token supplies them at the
    # userinfo endpoint instead, so only ask when the email is actually missing
    access_token = token_response.get("access_token")
    if not claims.get("email") and access_token:
        userinfo_claims = await fetch_userinfo(metadata, access_token, subject)
        claims = {**userinfo_claims, **claims}

    identity = await _find_identity(db, provider.id, subject)
    if identity is not None:
        return await _sign_in_identity(db, identity)

    email = claims.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Identity provider did not supply an email address",
        )

    # An email that already belongs to an account is never linked automatically, even when the
    # provider verified it, so a provider sign-in can never join an existing account without the
    # owner explicitly linking it from settings under step-up. The user signs in with their
    # password and links there instead. The detail is structured so the client can offer that
    # password sign-in prefilled with the address
    existing_user_id = await find_user_id_by_email(db, email)
    if existing_user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": OIDC_EMAIL_CONFLICT_CODE, "email": email},
        )

    return OidcOnboardingClaims(
        provider_slug=provider.slug,
        subject=subject,
        email=email,
        email_verified=claims.get("email_verified") is True,
        first_name=_derive_first_name(claims, email),
        last_name=claims.get("family_name") or None,
    )


async def complete_oidc_signup(
    db: AsyncSession,
    onboarding: OidcOnboardingClaims,
    first_name: str,
    last_name: str | None,
    tz: str,
    base_currency: str,
) -> User:
    """Create the user a verified provider sign-in onboarded, with their chosen profile fields

    Nothing was persisted when onboarding began, so this recreates every check a signup
    needs before inserting the user, the provider link, and the OIDC auth identity together

    Args:
        db: Active database session
        onboarding: Verified claims decoded from the onboarding token
        first_name: First name confirmed on the completion form
        last_name: Optional last name confirmed on the completion form
        tz: IANA timezone collected at completion
        base_currency: Base currency collected at completion

    Returns:
        The newly created user

    Raises:
        HTTPException: The provider vanished, the email or subject was claimed meanwhile,
            or the base currency is invalid
    """
    provider_query = select(OidcProvider).where(
        OidcProvider.slug == onboarding.provider_slug, OidcProvider.enabled
    )

    # The provider must still be enabled when signup completes, not just when it began
    provider = (await db.execute(provider_query)).scalar_one_or_none()
    if provider is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    # The subject could have been claimed by a parallel completion of the same onboarding
    if await _find_identity(db, provider.id, onboarding.subject) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sign-in already linked to an account")

    user_id = uuid.uuid4()

    # The provider and identity checks above ran before any identity existed, so close that
    # transaction and adopt the new user id, so the inserts below run on a connection
    # stamped for the self-only users policy
    current_user_id_ctx.set(user_id)
    await db.commit()

    await reject_registered_email(db, onboarding.email)
    await reject_missing_base_currency(db, base_currency)

    user = User(
        id=user_id,
        email=onboarding.email,
        first_name=first_name,
        last_name=last_name,
        tz=tz,
        base_currency=base_currency,
    )
    db.add(user)
    await db.flush()

    db.add(_build_oidc_auth_identity(user.id, onboarding.email_verified))
    db.add(
        OidcIdentity(
            user_id=user.id,
            provider_id=provider.id,
            subject=onboarding.subject,
            email=onboarding.email,
            last_login_at=datetime.now(UTC),
        )
    )

    await db.commit()
    await db.refresh(user)
    return user


async def begin_oidc_link(db: AsyncSession, user: User, provider: OidcProvider) -> str:
    """Start a roundtrip that links a provider to a signed-in account

    The caller has already verified step-up, so the stored roundtrip carries the account
    it was authorized for and only that account can complete it

    Args:
        db: Active database session
        user: Authenticated user linking the provider
        provider: Enabled provider being linked

    Returns:
        The provider's authorization URL bound to a stored single-use link roundtrip

    Raises:
        HTTPException: The provider's discovery document cannot be fetched
    """
    return await _begin_authorization(db, provider, OIDC_PURPOSE_LINK, user_id=user.id)


async def complete_oidc_link(
    db: AsyncSession, user: User, code: str, state: str
) -> tuple[OidcIdentity, OidcProvider]:
    """Finish a link roundtrip and attach the verified provider subject to the account

    Args:
        db: Active database session
        user: Authenticated user completing the link they authorized
        code: Authorization code the provider sent to the callback
        state: State value the provider echoed back

    Returns:
        The new identity and its provider

    Raises:
        HTTPException: The roundtrip is unknown, expired, or belongs to another account,
            the exchange or token does not verify, or the subject is already linked
    """
    request_row = await _consume_authorization_request(db, state, OIDC_PURPOSE_LINK)

    # The roundtrip was authorized by a step-up for one account, so no other session may
    # complete it even with a valid state and code
    if request_row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    provider = await get_enabled_oidc_provider_by_id(db, request_row.provider_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    metadata = await get_provider_metadata(provider.issuer)
    token_response = await exchange_authorization_code(
        metadata,
        client_id=provider.client_id,
        client_secret=decrypt(provider.client_secret_encrypted),
        code=code,
        code_verifier=request_row.code_verifier,
        redirect_uri=get_oidc_redirect_uri(),
    )
    claims = await verify_provider_id_token(
        token_response["id_token"], metadata, provider.client_id, request_row.nonce
    )
    subject: str = claims["sub"]

    existing_identity = await _find_identity(db, provider.id, subject)
    if existing_identity is not None:
        detail = (
            "Provider already linked to this account"
            if existing_identity.user_id == user.id
            else "Sign-in already linked to another account"
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)

    identity = OidcIdentity(
        user_id=user.id,
        provider_id=provider.id,
        subject=subject,
        email=claims.get("email"),
    )
    db.add(identity)

    # A first link also records OIDC as an auth provider for the account, once across all providers
    auth_identity_query = select(AuthIdentity).where(
        AuthIdentity.user_id == user.id, AuthIdentity.auth_provider == AuthProvider.OIDC
    )
    if (await db.execute(auth_identity_query)).scalar_one_or_none() is None:
        db.add(_build_oidc_auth_identity(user.id, email_verified=claims.get("email_verified") is True))

    await db.commit()
    await db.refresh(identity)
    return identity, provider


async def list_oidc_identities(db: AsyncSession, user: User) -> list[tuple[OidcIdentity, OidcProvider]]:
    """Return the account's linked identities with their providers, oldest link first

    Args:
        db: Active database session
        user: Authenticated user whose links are listed

    Returns:
        Identity and provider pairs for the settings list
    """
    identities_query = (
        select(OidcIdentity, OidcProvider)
        .join(OidcProvider, OidcIdentity.provider_id == OidcProvider.id)
        .where(OidcIdentity.user_id == user.id)
        .order_by(OidcIdentity.created_at)
    )

    # List the linked providers the settings page manages
    result = await db.execute(identities_query)
    return [(identity, provider) for identity, provider in result.all()]


async def unlink_oidc_identity(
    db: AsyncSession,
    user: User,
    identity_id: uuid.UUID,
    password: str,
    *,
    code: str | None = None,
    passkey: dict | None = None,
) -> None:
    """Remove a linked provider after step-up, refusing to strand the account

    Step-up runs first, the full password plus factor when one is enrolled and the
    password alone otherwise. The unlink is refused when no way to sign in would remain:
    no password, no passkey, and no other linked provider

    Args:
        db: Active database session
        user: Authenticated user removing the link
        identity_id: Identity row being removed
        password: Account password
        code: A current TOTP code, when stepping up by authenticator
        passkey: A passkey assertion, when stepping up by passkey

    Raises:
        HTTPException: The step-up fails, the identity is not the user's, or removing it
            would leave the account with no way to sign in
    """
    await verify_sensitive_action_step_up(db, user, password, code=code, passkey=passkey)

    identity = await db.get(OidcIdentity, identity_id)
    if identity is None or identity.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Linked sign-in not found")

    other_identities_query = select(sa_func.count()).where(
        OidcIdentity.user_id == user.id, OidcIdentity.id != identity_id
    )
    other_identity_count = (await db.execute(other_identities_query)).scalar_one()

    # The account must keep at least one way to sign in, otherwise this unlink is a lockout
    has_password = await get_password_credential(db, user.id) is not None
    if not has_password and not await is_passkey_registered(db, user.id) and other_identity_count == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Set a password before removing the only way to sign in",
        )

    await db.delete(identity)

    # The auth identity records OIDC as a sign-in method, so it goes when the last link does
    if other_identity_count == 0:
        auth_identity_query = select(AuthIdentity).where(
            AuthIdentity.user_id == user.id, AuthIdentity.auth_provider == AuthProvider.OIDC
        )
        auth_identity = (await db.execute(auth_identity_query)).scalar_one_or_none()
        if auth_identity is not None:
            await db.delete(auth_identity)

    await db.commit()


async def _consume_authorization_request(
    db: AsyncSession, state: str, purpose: str
) -> OidcAuthorizationRequest:
    """Spend the stored roundtrip a callback names and return it

    Args:
        db: Active database session
        state: State value the provider echoed back
        purpose: Flow the roundtrip must be scoped to

    Returns:
        The consumed roundtrip row

    Raises:
        HTTPException: No live roundtrip matches the state and purpose
    """
    claim_query = (
        delete(OidcAuthorizationRequest)
        .where(
            OidcAuthorizationRequest.state_hash == hash_token(state),
            OidcAuthorizationRequest.purpose == purpose,
            OidcAuthorizationRequest.expires_at > sa_func.now(),
        )
        .returning(OidcAuthorizationRequest)
    )

    # Delete and commit before contacting the provider so single use holds even when a
    # later step fails, forcing a fresh roundtrip instead of a replay
    result = await db.execute(claim_query)
    request_row = result.scalar_one_or_none()
    await db.commit()

    if request_row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")
    return request_row


async def _find_identity(db: AsyncSession, provider_id: uuid.UUID, subject: str) -> OidcIdentity | None:
    """Return the identity a provider subject is linked to, when one exists

    Args:
        db: Active database session
        provider_id: Provider the subject belongs to
        subject: Subject claim from the verified ID token

    Returns:
        The matching identity row when the subject has signed in before
    """
    identity_query = select(OidcIdentity).where(
        OidcIdentity.provider_id == provider_id, OidcIdentity.subject == subject
    )

    # Look up the returning sign-in by the provider's permanent subject identifier
    result = await db.execute(identity_query)
    return result.scalar_one_or_none()


async def _sign_in_identity(db: AsyncSession, identity: OidcIdentity) -> User:
    """Sign in the user a linked identity belongs to

    Args:
        db: Active database session
        identity: Linked identity that matched the verified token

    Returns:
        The authenticated user

    Raises:
        HTTPException: The linked user no longer exists
    """
    identity.last_login_at = datetime.now(UTC)

    # The lookups above ran before any identity existed, so adopt the resolved user and
    # reopen the transaction, so loading the user re-stamps it for the self-only users policy
    current_user_id_ctx.set(identity.user_id)
    await db.commit()

    user = await db.get(User, identity.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")
    return user


def _build_oidc_auth_identity(user_id: uuid.UUID, email_verified: bool) -> AuthIdentity:
    """Return the OIDC auth identity row recording how this account can authenticate

    Args:
        user_id: Account the identity belongs to
        email_verified: Whether the provider asserted the email as verified

    Returns:
        The unsaved auth identity row
    """
    return AuthIdentity(
        user_id=user_id,
        auth_provider=AuthProvider.OIDC,
        email_verified=email_verified,
        email_verified_at=datetime.now(UTC) if email_verified else None,
    )


def _derive_first_name(claims: dict, email: str) -> str:
    """Return the best first name the provider's claims offer for the completion form

    Args:
        claims: Verified and userinfo claims merged together
        email: Email the provider asserted

    Returns:
        The given name, the first word of the full name, or the email's local part
    """
    given_name = claims.get("given_name")
    if isinstance(given_name, str) and given_name.strip():
        return given_name.strip()

    full_name = claims.get("name")
    if isinstance(full_name, str) and full_name.strip():
        return full_name.strip().split()[0]

    return email.split("@")[0]
