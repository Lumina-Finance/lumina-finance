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
from webauthn import generate_registration_options, options_to_json, verify_registration_response
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.exceptions import InvalidRegistrationResponse
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
from app.models.auth import AuthIdentity, WebauthnChallenge, WebauthnCredential
from app.models.base import AuthProvider

# Distinguishes a registration challenge from an authentication one in the shared challenge table
_REGISTRATION_PURPOSE = "registration"

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


async def _claim_registration_challenge(
    db: AsyncSession, user_id: uuid.UUID, credential: dict
) -> bytes:
    """Consume the stored challenge that the registration response answers

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
    try:
        client_data = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
        challenge = base64url_to_bytes(client_data["challenge"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed passkey response") from error

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
