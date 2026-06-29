"""Passkey registration ceremony and credential management

Wraps the WebAuthn library so the rest of the app deals in stored credentials and JSON ceremony
options rather than attestation internals. Passkeys are registered with a resident key and user
verification so a single passkey can later serve as both a passwordless login and a second factor
"""

import json
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import (
    WEBAUTHN_CHALLENGE_EXPIRE_SECONDS,
    WEBAUTHN_ORIGINS,
    WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME,
)
from app.database import current_user_id_ctx
from app.models.auth import AuthIdentity, WebauthnChallenge, WebauthnCredential
from app.models.base import AuthProvider
from app.models.user import User

# Distinguishes a registration challenge from an authentication one in the shared challenge table
_REGISTRATION_PURPOSE = "registration"
_AUTHENTICATION_PURPOSE = "authentication"

# Transport hints round-trip as a comma-separated string, so the value is recognized on the next prompt
_TRANSPORT_SEPARATOR = ","


def _known_transports(values: list[str]) -> list[AuthenticatorTransport]:
    """Keep only transport hints the library recognizes, dropping any future browser additions"""
    recognized = {transport.value for transport in AuthenticatorTransport}
    return [AuthenticatorTransport(value) for value in values if value in recognized]


async def build_passkey_registration_options(db: AsyncSession, user_id: uuid.UUID, account_name: str) -> str:
    """Begin registration by issuing ceremony options and storing their challenge

    Existing passkeys are excluded so the same authenticator cannot be enrolled twice. The challenge
    is persisted so the matching verify call can prove the response answers an option this server issued

    Args:
        db: Active database session
        user_id: User registering a passkey
        account_name: Label shown by the authenticator, the user's email

    Returns:
        The ceremony options serialized as JSON for the browser
    """
    await _delete_expired_challenges(db)

    existing = await list_passkeys(db, user_id)
    exclude_credentials = [
        PublicKeyCredentialDescriptor(
            id=passkey.credential_id,
            transports=_known_transports(passkey.transports.split(_TRANSPORT_SEPARATOR)) if passkey.transports else None,
        )
        for passkey in existing
    ]

    options = generate_registration_options(
        rp_id=WEBAUTHN_RP_ID,
        rp_name=WEBAUTHN_RP_NAME,
        user_id=user_id.bytes,
        user_name=account_name,
        user_display_name=account_name,
        exclude_credentials=exclude_credentials,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )

    expires_at = datetime.now(UTC) + timedelta(seconds=WEBAUTHN_CHALLENGE_EXPIRE_SECONDS)
    db.add(WebauthnChallenge(
        challenge=options.challenge,
        user_id=user_id,
        purpose=_REGISTRATION_PURPOSE,
        expires_at=expires_at,
    ))
    await db.commit()

    return options_to_json(options)


async def register_passkey(
    db: AsyncSession, user_id: uuid.UUID, credential: dict, name: str
) -> WebauthnCredential:
    """Verify a finished registration ceremony and store the new passkey

    The challenge embedded in the response locates the stored challenge so concurrent ceremonies stay
    independent, and the challenge is single-use because it is deleted once claimed. The first passkey
    also records a WebAuthn auth identity so the account is recognized as passkey-capable

    Args:
        db: Active database session
        user_id: User the passkey belongs to
        credential: Attestation response returned by the browser
        name: Label to store the passkey under

    Returns:
        The stored passkey credential

    Raises:
        HTTPException: The challenge is unknown or expired, or the attestation fails to verify
    """
    challenge = await _claim_registration_challenge(db, user_id, credential)

    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGINS,
            require_user_verification=True,
        )
    except InvalidRegistrationResponse as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey registration failed") from error

    transports = credential.get("response", {}).get("transports") or []
    passkey = WebauthnCredential(
        user_id=user_id,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
        transports=_TRANSPORT_SEPARATOR.join(transports) or None,
        name=name,
    )
    db.add(passkey)

    await _ensure_webauthn_identity(db, user_id)
    await db.commit()
    await db.refresh(passkey)
    return passkey


async def build_passkey_authentication_options(db: AsyncSession) -> str:
    """Begin a usernameless sign-in by issuing ceremony options and storing their challenge

    No credentials are listed, so the browser offers any passkey discoverable for this site and the
    user is only known once the assertion resolves. The challenge carries no user id for the same reason

    Args:
        db: Active database session

    Returns:
        The ceremony options serialized as JSON for the browser
    """
    await _delete_expired_challenges(db)

    options = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        user_verification=UserVerificationRequirement.REQUIRED,
    )

    expires_at = datetime.now(UTC) + timedelta(seconds=WEBAUTHN_CHALLENGE_EXPIRE_SECONDS)
    db.add(WebauthnChallenge(
        challenge=options.challenge,
        user_id=None,
        purpose=_AUTHENTICATION_PURPOSE,
        expires_at=expires_at,
    ))
    await db.commit()

    return options_to_json(options)


async def verify_passkey_authentication(db: AsyncSession, credential: dict) -> User:
    """Verify a sign-in assertion and return the user it authenticates

    The credential id resolves which stored passkey signed the assertion, and its public key verifies
    the signature. A user-verified assertion stands in for both factors, so the caller issues a full
    session. The signature counter is advanced to detect a cloned authenticator on a later sign-in

    Args:
        db: Active database session
        credential: Assertion response returned by the browser

    Returns:
        The authenticated user

    Raises:
        HTTPException: The challenge is unknown or expired, the passkey is unrecognized, or the
            assertion fails to verify
    """
    challenge = await _claim_authentication_challenge(db, credential)
    passkey = await _resolve_credential(db, credential)

    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGINS,
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey sign-in failed") from error

    passkey.sign_count = verification.new_sign_count
    passkey.last_used_at = datetime.now(UTC)

    # The lookups above ran before any identity existed, so adopt the resolved user and reopen the
    # transaction, so loading the user re-stamps it for the self-only users policy
    current_user_id_ctx.set(passkey.user_id)
    await db.commit()

    user = await db.get(User, passkey.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey sign-in failed")
    return user


async def list_passkeys(db: AsyncSession, user_id: uuid.UUID) -> list[WebauthnCredential]:
    """Return the user's registered passkeys, newest first

    Args:
        db: Active database session
        user_id: User whose passkeys to list

    Returns:
        The user's passkey credentials
    """
    # Scoped to the user explicitly since the auth tables carry no row-level security
    passkeys_query = (
        select(WebauthnCredential)
        .where(WebauthnCredential.user_id == user_id)
        .order_by(WebauthnCredential.created_at.desc())
    )
    result = await db.execute(passkeys_query)
    return list(result.scalars().all())


async def rename_passkey(
    db: AsyncSession, user_id: uuid.UUID, passkey_id: uuid.UUID, name: str
) -> WebauthnCredential:
    """Relabel one of the user's passkeys

    Args:
        db: Active database session
        user_id: User the passkey must belong to
        passkey_id: Passkey to relabel
        name: New label

    Returns:
        The updated passkey credential

    Raises:
        HTTPException: The passkey does not exist or belongs to another user
    """
    passkey = await _get_owned_passkey(db, user_id, passkey_id)
    passkey.name = name
    await db.commit()
    await db.refresh(passkey)
    return passkey


async def remove_passkey(db: AsyncSession, user_id: uuid.UUID, passkey_id: uuid.UUID) -> None:
    """Delete one of the user's passkeys, dropping the auth identity once the last one is gone

    Args:
        db: Active database session
        user_id: User the passkey must belong to
        passkey_id: Passkey to delete

    Raises:
        HTTPException: The passkey does not exist or belongs to another user
    """
    passkey = await _get_owned_passkey(db, user_id, passkey_id)
    await db.delete(passkey)
    await db.flush()

    remaining = await list_passkeys(db, user_id)
    if not remaining:
        await db.execute(
            delete(AuthIdentity).where(
                AuthIdentity.user_id == user_id,
                AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
            )
        )
    await db.commit()


async def _get_owned_passkey(
    db: AsyncSession, user_id: uuid.UUID, passkey_id: uuid.UUID
) -> WebauthnCredential:
    """Return the user's passkey by id or raise when it is missing or owned by someone else"""
    passkey = await db.get(WebauthnCredential, passkey_id)
    if passkey is None or passkey.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey not found")
    return passkey


def _read_challenge_bytes(credential: dict) -> bytes:
    """Return the challenge the browser echoed back in the response client data

    Raises:
        HTTPException: The response is missing or carries malformed client data
    """
    try:
        client_data = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
        return base64url_to_bytes(client_data["challenge"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed passkey response") from error


async def _claim_registration_challenge(
    db: AsyncSession, user_id: uuid.UUID, credential: dict
) -> bytes:
    """Consume the stored registration challenge that the response answers

    Reading the challenge out of the client data ties the response to the exact stored row, so two
    overlapping registration ceremonies cannot claim each other's challenge. The row is deleted in the
    same step to make the challenge single-use

    Args:
        db: Active database session
        user_id: User the challenge was issued to
        credential: Attestation response returned by the browser

    Returns:
        The raw challenge bytes to verify the response against

    Raises:
        HTTPException: The response is malformed, or the challenge is unknown or expired
    """
    challenge = _read_challenge_bytes(credential)

    # Claim the matching unexpired registration challenge in one delete so a replay finds it gone
    claim_query = delete(WebauthnChallenge).where(
        WebauthnChallenge.challenge == challenge,
        WebauthnChallenge.user_id == user_id,
        WebauthnChallenge.purpose == _REGISTRATION_PURPOSE,
        WebauthnChallenge.expires_at > sa_func.now(),
    )
    result = await db.execute(claim_query)
    if result.rowcount != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey challenge expired")

    return challenge


async def _claim_authentication_challenge(db: AsyncSession, credential: dict) -> bytes:
    """Consume the stored authentication challenge that the assertion answers

    A usernameless ceremony stores the challenge with no user, so it is claimed by its value alone. The
    single delete makes it single-use, which is what stops a captured assertion being replayed

    Args:
        db: Active database session
        credential: Assertion response returned by the browser

    Returns:
        The raw challenge bytes to verify the assertion against

    Raises:
        HTTPException: The response is malformed, or the challenge is unknown or expired
    """
    challenge = _read_challenge_bytes(credential)

    claim_query = delete(WebauthnChallenge).where(
        WebauthnChallenge.challenge == challenge,
        WebauthnChallenge.purpose == _AUTHENTICATION_PURPOSE,
        WebauthnChallenge.expires_at > sa_func.now(),
    )
    result = await db.execute(claim_query)
    if result.rowcount != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey challenge expired")

    return challenge


async def _resolve_credential(db: AsyncSession, credential: dict) -> WebauthnCredential:
    """Return the stored passkey the assertion was signed with

    Args:
        db: Active database session
        credential: Assertion response returned by the browser

    Returns:
        The passkey whose raw credential id matches the assertion

    Raises:
        HTTPException: The response is malformed, or no passkey matches the credential id
    """
    try:
        raw_credential_id = base64url_to_bytes(credential["rawId"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed passkey response") from error

    # The credential id is unique across users, so it alone identifies the signing passkey
    result = await db.execute(
        select(WebauthnCredential).where(WebauthnCredential.credential_id == raw_credential_id)
    )
    passkey = result.scalar_one_or_none()
    if passkey is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey not recognized")
    return passkey


async def _ensure_webauthn_identity(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Record a WebAuthn auth identity for the user when the first passkey is registered"""
    identity_query = select(AuthIdentity).where(
        AuthIdentity.user_id == user_id,
        AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
    )
    result = await db.execute(identity_query)
    if result.scalar_one_or_none() is None:
        db.add(AuthIdentity(user_id=user_id, auth_provider=AuthProvider.WEBAUTHN))


async def _delete_expired_challenges(db: AsyncSession) -> None:
    """Prune challenges whose expiry has passed, since unclaimed ones are never cleaned up otherwise"""
    await db.execute(delete(WebauthnChallenge).where(WebauthnChallenge.expires_at < sa_func.now()))
