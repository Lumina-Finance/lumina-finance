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
    TWO_FACTOR_STAGING_EXPIRE_SECONDS,
    WEBAUTHN_CHALLENGE_EXPIRE_SECONDS,
    WEBAUTHN_ORIGINS,
    WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME,
)
from app.database import current_user_id_ctx
from app.models.auth import AuthIdentity, RecoveryCode, WebauthnChallenge, WebauthnCredential
from app.models.base import AuthProvider
from app.models.user import User
from app.services.auth.recovery_codes import (
    activate_pending_recovery_codes,
    generate_recovery_codes,
    has_active_recovery_codes,
    has_pending_recovery_codes,
)
from app.services.auth.sessions import delete_all_user_auth_sessions

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

    # Exclude every credential the user already holds, including a staged one, so the same authenticator
    # cannot be enrolled twice while a first passkey is still pending acknowledgement
    existing = await db.execute(select(WebauthnCredential).where(WebauthnCredential.user_id == user_id))
    exclude_credentials = [
        PublicKeyCredentialDescriptor(
            id=passkey.credential_id,
            transports=_known_transports(passkey.transports.split(_TRANSPORT_SEPARATOR)) if passkey.transports else None,
        )
        for passkey in existing.scalars()
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
) -> tuple[WebauthnCredential, list[str] | None]:
    """Verify a finished registration ceremony and store the new passkey

    The challenge embedded in the response locates the stored challenge so concurrent ceremonies stay
    independent, and the challenge is single-use because it is deleted once claimed.

    A first passkey, on an account with no recovery codes yet, is the account's first second factor, so
    it is stored inactive and a shared recovery batch is staged for the user to save. It only becomes a
    usable factor once those codes are acknowledged. A routine later passkey activates immediately and
    reuses the existing recovery codes, while a forced re-enrol is excluded so it stages a fresh batch

    Args:
        db: Active database session
        user_id: User the passkey belongs to
        credential: Attestation response returned by the browser
        name: Label to store the passkey under

    Returns:
        The stored passkey and, when it is the first second factor, the recovery codes to save once

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

    user = await db.get(User, user_id)

    # Reuse the account's batch only for a routine added factor, never during a forced re-enrol, which
    # must stage a fresh batch like a first factor
    reuse_existing_codes = await has_active_recovery_codes(db, user_id) and not user.totp_reenrollment_required

    transports = credential.get("response", {}).get("transports") or []
    passkey = WebauthnCredential(
        user_id=user_id,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
        transports=_TRANSPORT_SEPARATOR.join(transports) or None,
        name=name,
        confirmed_at=datetime.now(UTC) if reuse_existing_codes else None,
    )
    db.add(passkey)

    # A first factor or a forced re-enrol stays inactive until its fresh recovery codes are acknowledged
    recovery_codes = None
    if reuse_existing_codes:
        await _ensure_webauthn_identity(db, user_id)
    else:
        recovery_codes = await generate_recovery_codes(db, user_id, pending=True)

    await db.commit()
    await db.refresh(passkey)
    return passkey, recovery_codes


async def confirm_passkey_registration(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Activate a staged passkey once the user has saved the recovery codes issued with it

    Both the staged passkey and the staged recovery batch are promoted together, so the account never
    has an enforced passkey factor whose recovery codes were never saved. When this finishes a forced
    re-enrol it also signs out every session, so the recovery path ends in a fresh login rather than
    promoting its restricted session

    Args:
        db: Active database session
        user_id: User confirming their staged passkey

    Raises:
        HTTPException: No staged passkey with pending recovery codes is awaiting confirmation
    """
    staged = await _staged_passkeys(db, user_id)
    if not staged or not await has_pending_recovery_codes(db, user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No passkey awaiting confirmation")

    user = await db.get(User, user_id)
    was_forced_reenrollment = user.totp_reenrollment_required

    confirmed_at = datetime.now(UTC)
    for passkey in staged:
        passkey.confirmed_at = confirmed_at

    await activate_pending_recovery_codes(db, user_id)
    await _ensure_webauthn_identity(db, user_id)
    await _clear_reenrollment_restriction(db, user_id)

    # A forced re-enrol grants only a re-enrol session, so completing it signs out everywhere and sends
    # the user back to a fresh login with the new factor
    if was_forced_reenrollment:
        await delete_all_user_auth_sessions(db, user_id)

    await db.commit()


async def is_passkey_registered(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Return whether the user has at least one active passkey

    A staged passkey awaiting recovery-code acknowledgement does not count, since it cannot yet be used
    as a factor

    Args:
        db: Active database session
        user_id: User to check

    Returns:
        Whether a confirmed passkey exists
    """
    result = await db.execute(
        select(WebauthnCredential.id)
        .where(WebauthnCredential.user_id == user_id, WebauthnCredential.confirmed_at.is_not(None))
        .limit(1)
    )
    return result.first() is not None


async def prune_stale_passkey_staging(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Delete the user's staged passkeys and recovery codes that have gone stale

    There is no reliable signal that a user abandoned setup, so stale staged rows are swept by ordinary
    actions such as login rather than at the moment they are left. The caller commits

    Args:
        db: Active database session
        user_id: User whose stale staged rows are cleared
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=TWO_FACTOR_STAGING_EXPIRE_SECONDS)
    await db.execute(
        delete(WebauthnCredential).where(
            WebauthnCredential.user_id == user_id,
            WebauthnCredential.confirmed_at.is_(None),
            WebauthnCredential.created_at < cutoff,
        )
    )
    await db.execute(
        delete(RecoveryCode).where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.pending.is_(True),
            RecoveryCode.created_at < cutoff,
        )
    )


async def revoke_all_passkeys(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Delete every passkey and the WebAuthn identity for a user

    A recovery-code sign-in wipes all second factors, so both staged and active passkeys are removed
    together with the identity that let a passkey stand in for a login. The caller commits

    Args:
        db: Active database session
        user_id: User whose passkeys and WebAuthn identity are removed
    """
    await db.execute(delete(WebauthnCredential).where(WebauthnCredential.user_id == user_id))
    await db.execute(
        delete(AuthIdentity).where(
            AuthIdentity.user_id == user_id,
            AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
        )
    )


async def _staged_passkeys(db: AsyncSession, user_id: uuid.UUID) -> list[WebauthnCredential]:
    """Return the user's passkeys still awaiting recovery-code acknowledgement"""
    result = await db.execute(
        select(WebauthnCredential).where(
            WebauthnCredential.user_id == user_id, WebauthnCredential.confirmed_at.is_(None)
        )
    )
    return list(result.scalars().all())


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


async def build_passkey_second_factor_options(db: AsyncSession, user_id: uuid.UUID) -> str:
    """Begin a passkey second-factor step for a user who has already passed their password

    The user's own passkeys are listed so the browser prompts for one of them, and the challenge is
    scoped to the user since the login challenge token already established who they are

    Args:
        db: Active database session
        user_id: User completing the second factor

    Returns:
        The ceremony options serialized as JSON for the browser
    """
    await _delete_expired_challenges(db)

    allow_credentials = [
        PublicKeyCredentialDescriptor(
            id=passkey.credential_id,
            transports=_known_transports(passkey.transports.split(_TRANSPORT_SEPARATOR)) if passkey.transports else None,
        )
        for passkey in await list_passkeys(db, user_id)
    ]

    # User verification is preferred rather than required, since the password already proved knowledge
    # and the passkey only has to prove possession here
    options = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    expires_at = datetime.now(UTC) + timedelta(seconds=WEBAUTHN_CHALLENGE_EXPIRE_SECONDS)
    db.add(WebauthnChallenge(
        challenge=options.challenge,
        user_id=user_id,
        purpose=_AUTHENTICATION_PURPOSE,
        expires_at=expires_at,
    ))
    await db.commit()

    return options_to_json(options)


async def verify_passkey_second_factor(db: AsyncSession, user_id: uuid.UUID, credential: dict) -> None:
    """Verify a passkey assertion presented as the second factor of a password login

    The assertion must answer the user's own scoped challenge and be signed by one of their passkeys.
    Unlike a passwordless sign-in this does not adopt an identity or issue tokens, since the caller
    already holds the login challenge and commits the surrounding transaction

    Args:
        db: Active database session
        user_id: User the login challenge belongs to
        credential: Assertion response returned by the browser

    Raises:
        HTTPException: The challenge is unknown or expired, the passkey is not the user's, or the
            assertion fails to verify
    """
    challenge = await _claim_authentication_challenge(db, credential, user_id=user_id)
    passkey = await _resolve_credential(db, credential)
    if passkey.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey sign-in failed")

    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGINS,
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
        )
    except InvalidAuthenticationResponse as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey sign-in failed") from error

    passkey.sign_count = verification.new_sign_count
    passkey.last_used_at = datetime.now(UTC)


async def list_passkeys(db: AsyncSession, user_id: uuid.UUID) -> list[WebauthnCredential]:
    """Return the user's active passkeys, newest first

    A staged passkey awaiting recovery-code acknowledgement is left out, since it is not yet a usable
    credential and must not appear as a managed one

    Args:
        db: Active database session
        user_id: User whose passkeys to list

    Returns:
        The user's confirmed passkey credentials
    """
    # Scoped to the user explicitly since the auth tables carry no row-level security
    passkeys_query = (
        select(WebauthnCredential)
        .where(WebauthnCredential.user_id == user_id, WebauthnCredential.confirmed_at.is_not(None))
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


async def _claim_authentication_challenge(
    db: AsyncSession, credential: dict, user_id: uuid.UUID | None = None
) -> bytes:
    """Consume the stored authentication challenge that the assertion answers

    A usernameless sign-in stores the challenge with no user and is claimed by its value alone, while a
    second-factor ceremony scopes the challenge to the user it was issued for. The single delete makes
    it single-use, which is what stops a captured assertion being replayed

    Args:
        db: Active database session
        credential: Assertion response returned by the browser
        user_id: User the challenge must belong to, for a second-factor ceremony

    Returns:
        The raw challenge bytes to verify the assertion against

    Raises:
        HTTPException: The response is malformed, or the challenge is unknown or expired
    """
    challenge = _read_challenge_bytes(credential)

    conditions = [
        WebauthnChallenge.challenge == challenge,
        WebauthnChallenge.purpose == _AUTHENTICATION_PURPOSE,
        WebauthnChallenge.expires_at > sa_func.now(),
    ]
    if user_id is not None:
        conditions.append(WebauthnChallenge.user_id == user_id)

    result = await db.execute(delete(WebauthnChallenge).where(*conditions))
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

    # The credential id is unique across users, so it alone identifies the signing passkey. A staged
    # passkey cannot sign in, so only a confirmed one resolves
    result = await db.execute(
        select(WebauthnCredential).where(
            WebauthnCredential.credential_id == raw_credential_id,
            WebauthnCredential.confirmed_at.is_not(None),
        )
    )
    passkey = result.scalar_one_or_none()
    if passkey is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey not recognized")
    return passkey


async def _clear_reenrollment_restriction(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Lift any second-factor re-enrolment restriction now that the user has an active passkey

    A recovery-code login restricts the session until a second factor is re-established, and an active
    passkey satisfies that the same way completing a fresh TOTP enrolment does. The caller commits
    """
    user = await db.get(User, user_id)
    if user is not None:
        user.totp_reenrollment_required = False


async def _ensure_webauthn_identity(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Record a WebAuthn auth identity once the user has an active passkey, if not already present"""
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
