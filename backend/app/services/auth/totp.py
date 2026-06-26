"""TOTP secret generation, code verification, and credential persistence"""

import uuid
from datetime import UTC, datetime

import pyotp
from fastapi import HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.encryption import decrypt, encrypt
from app.models.auth import TotpCredential

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


def is_totp_code_valid(secret: str, code: str) -> bool:
    """Return whether a submitted code matches the secret within the accepted time window

    Args:
        secret: Base32 TOTP secret
        code: Submitted code from the authenticator app

    Returns:
        Whether the code is valid for the current or an adjacent time step
    """
    totp = pyotp.TOTP(secret, digits=_TOTP_DIGITS, interval=_TOTP_PERIOD_SECONDS)
    return totp.verify(code, valid_window=_TOTP_VALID_WINDOW)


async def begin_totp_setup(db: AsyncSession, user_id: uuid.UUID, account_name: str) -> tuple[str, str]:
    """Start TOTP enrolment by persisting a pending encrypted secret

    A pending credential is overwritten so an abandoned setup can be retried, while a confirmed
    credential is refused because replacing a live second factor requires step-up

    Args:
        db: Active database session
        user_id: User enrolling in TOTP
        account_name: Label shown in the authenticator app, the user's email

    Returns:
        The base32 secret and the provisioning URI for the QR

    Raises:
        HTTPException: TOTP is already confirmed for this user
    """
    secret = generate_totp_secret()
    credential = await db.get(TotpCredential, user_id)
    if credential is not None and credential.confirmed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Two-factor authentication is already enabled")

    if credential is None:
        db.add(TotpCredential(user_id=user_id, secret_encrypted=encrypt(secret)))
    else:
        credential.secret_encrypted = encrypt(secret)
    await db.commit()

    return secret, build_totp_provisioning_uri(secret, account_name)


async def confirm_totp_setup(db: AsyncSession, user_id: uuid.UUID, code: str) -> bool:
    """Confirm a pending TOTP secret by verifying the first code

    The caller commits so confirmation and recovery code issuance share one transaction

    Args:
        db: Active database session
        user_id: User confirming enrolment
        code: Code from the authenticator app

    Returns:
        Whether a pending secret existed and the code verified
    """
    credential = await db.get(TotpCredential, user_id)
    if credential is None:
        return False

    if not is_totp_code_valid(decrypt(credential.secret_encrypted), code):
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


async def disable_totp(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Delete the user's TOTP credential

    The caller commits and also removes the recovery codes so disabling is atomic

    Args:
        db: Active database session
        user_id: User disabling TOTP
    """
    await db.execute(delete(TotpCredential).where(TotpCredential.user_id == user_id))
