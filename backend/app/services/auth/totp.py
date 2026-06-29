"""TOTP secret generation, code verification, and credential persistence"""

import secrets
import uuid
from datetime import UTC, datetime

import pyotp
from fastapi import HTTPException, status
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.encryption import decrypt, encrypt
from app.models.auth import TotpCredential
from app.services.auth.recovery_codes import delete_pending_recovery_codes

# Authenticator apps assume these defaults and many ignore other values, so they are fixed
_TOTP_DIGITS = 6
_TOTP_PERIOD_SECONDS = 30
_TOTP_ISSUER = "Lumina Finance"

# Accept the adjacent 30-second step on each side to absorb typing lag and clock skew
_TOTP_VALID_WINDOW = 1


def generate_totp_secret() -> str:
    """Return a new base32 TOTP secret"""
    return pyotp.random_base32()


def build_totp_provisioning_uri(secret: str, account_name: str) -> str:
    """Return the otpauth URI an authenticator app encodes as a QR code

    Args:
        secret: Base32 TOTP secret
        account_name: Label shown in the authenticator app, the user's email

    Returns:
        otpauth provisioning URI
    """
    totp = pyotp.TOTP(secret, digits=_TOTP_DIGITS, interval=_TOTP_PERIOD_SECONDS)
    return totp.provisioning_uri(name=account_name, issuer_name=_TOTP_ISSUER)


def match_totp_step(secret: str, code: str) -> int | None:
    """Return the time step a code matches within the accepted window, or None for no match

    Returning the step lets callers reject a step that was already spent, which blocks replay of a
    code within its validity window

    Args:
        secret: Base32 TOTP secret
        code: Submitted code from the authenticator app

    Returns:
        The matching time step, or None when the code matches no step in the window
    """
    totp = pyotp.TOTP(secret, digits=_TOTP_DIGITS, interval=_TOTP_PERIOD_SECONDS)
    current_step = int(datetime.now(UTC).timestamp()) // _TOTP_PERIOD_SECONDS

    # Compare against each step in the window with a constant-time check rather than relying on verify,
    # so the matched step is known and can be recorded
    for step in range(current_step - _TOTP_VALID_WINDOW, current_step + _TOTP_VALID_WINDOW + 1):
        if secrets.compare_digest(totp.at(step * _TOTP_PERIOD_SECONDS), code):
            return step

    return None


def is_totp_code_valid(secret: str, code: str) -> bool:
    """Return whether a submitted code matches the secret within the accepted time window

    Args:
        secret: Base32 TOTP secret
        code: Submitted code from the authenticator app

    Returns:
        Whether the code is valid for the current or an adjacent time step
    """
    return match_totp_step(secret, code) is not None


async def begin_totp_setup(db: AsyncSession, user_id: uuid.UUID, account_name: str) -> tuple[str, str]:
    """Start TOTP enrolment by persisting a pending encrypted secret

    A pending credential is overwritten so an abandoned setup can be retried, while a confirmed
    credential is refused because replacing a live second factor requires step-up. Any staged
    recovery codes from an abandoned attempt are cleared so completion still needs a fresh confirm
    and two-factor can never be enabled around an unverified secret

    Args:
        db: Active database session
        user_id: User enrolling in TOTP
        account_name: Label shown in the authenticator app, the user's email

    Returns:
        The base32 secret and the provisioning URI for the QR

    Raises:
        HTTPException: TOTP is already confirmed for this user
    """
    credential = await db.get(TotpCredential, user_id)
    if credential is not None and credential.confirmed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Two-factor authentication is already enabled")

    # Discard staged codes from an abandoned attempt, but leave an active batch intact for re-enrol
    await delete_pending_recovery_codes(db, user_id)

    secret = generate_totp_secret()
    encrypted_secret = encrypt(secret)

    # Upsert atomically so two near-simultaneous setup requests cannot collide on the primary key,
    # and never overwrite a confirmed secret if confirmation lands between the read above and here
    upsert = (
        pg_insert(TotpCredential)
        .values(user_id=user_id, secret_encrypted=encrypted_secret)
        .on_conflict_do_update(
            index_elements=[TotpCredential.user_id],
            set_={"secret_encrypted": encrypted_secret},
            where=TotpCredential.confirmed_at.is_(None),
        )
    )
    await db.execute(upsert)
    await db.commit()

    return secret, build_totp_provisioning_uri(secret, account_name)


async def is_pending_totp_code_valid(db: AsyncSession, user_id: uuid.UUID, code: str) -> bool:
    """Return whether a code matches the user's pending, not yet confirmed TOTP secret

    Args:
        db: Active database session
        user_id: User confirming enrolment
        code: Code from the authenticator app

    Returns:
        Whether a pending secret exists and the code verifies
    """
    credential = await db.get(TotpCredential, user_id)
    if credential is None or credential.confirmed_at is not None:
        return False

    return is_totp_code_valid(decrypt(credential.secret_encrypted), code)


async def mark_totp_confirmed(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Turn on two-factor by stamping the pending credential as confirmed

    Enabling is the last enrolment step so an abandoned setup never leaves two-factor half on. The
    caller commits so it is atomic with any surrounding changes

    Args:
        db: Active database session
        user_id: User finishing enrolment

    Returns:
        Whether a pending credential existed to confirm
    """
    credential = await db.get(TotpCredential, user_id)
    if credential is None or credential.confirmed_at is not None:
        return False

    credential.confirmed_at = datetime.now(UTC)
    return True


async def is_totp_enabled(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Return whether the user has a confirmed TOTP credential

    Args:
        db: Active database session
        user_id: User to check

    Returns:
        Whether a confirmed credential exists
    """
    credential = await db.get(TotpCredential, user_id)
    return credential is not None and credential.confirmed_at is not None


async def is_user_totp_code_valid(db: AsyncSession, user_id: uuid.UUID, code: str) -> bool:
    """Return whether a code matches the user's confirmed TOTP secret, rejecting a replayed code

    A matching step at or before the last accepted one is refused, so a code cannot be reused within
    its validity window. The caller commits the recorded step

    Args:
        db: Active database session
        user_id: User whose secret verifies the code
        code: Submitted code from the authenticator app

    Returns:
        Whether the user has a confirmed credential and the code is valid and unused
    """
    credential = await db.get(TotpCredential, user_id)
    if credential is None or credential.confirmed_at is None:
        return False

    step = match_totp_step(decrypt(credential.secret_encrypted), code)
    if step is None:
        return False

    if credential.last_used_step is not None and step <= credential.last_used_step:
        return False

    credential.last_used_step = step
    return True


async def disable_totp(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Delete the user's TOTP credential

    The caller commits and also removes the recovery codes so disabling is atomic

    Args:
        db: Active database session
        user_id: User disabling TOTP
    """
    await db.execute(delete(TotpCredential).where(TotpCredential.user_id == user_id))
