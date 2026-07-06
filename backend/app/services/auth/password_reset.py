"""Password reset request and token service"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import APP_URL, PASSWORD_RESET_TOKEN_EXPIRE_SECONDS
from app.database import current_user_id_ctx
from app.models.auth import PasswordCredential, PasswordResetToken
from app.models.user import User
from app.services.auth.mfa_challenge import MFA_PURPOSE_PASSWORD_RESET, issue_mfa_challenge
from app.services.auth.password_helpers import hash_password
from app.services.auth.sessions import delete_all_user_auth_sessions
from app.services.auth.token_hashing import hash_token
from app.services.auth.totp import is_totp_enabled
from app.services.auth.user_lookup import find_user_id_by_email
from app.services.auth.webauthn import is_passkey_registered
from app.services.email import get_email_sender, render_reset_email

# 32 random bytes give a 256-bit token, infeasible to guess so a fast hash resists leaks
_TOKEN_BYTES = 32
_RESET_PATH = "/reset-password"

# One message for every token failure so responses do not reveal which check rejected it
_INVALID_TOKEN_DETAIL = "Invalid or expired reset token"  # noqa: S105


@dataclass(frozen=True)
class ResetSecondFactorRequired:
    """Challenge issued because the account has an active second factor"""

    mfa_token: str
    totp_enabled: bool
    passkey_available: bool


async def delete_expired_password_reset_tokens(db: AsyncSession) -> None:
    """Delete reset tokens whose expiry has passed

    Args:
        db: Active database session
    """
    expired_delete_query = delete(PasswordResetToken).where(PasswordResetToken.expires_at < sa_func.now())

    # Unredeemed tokens are never cleaned up otherwise, so prune them opportunistically
    await db.execute(expired_delete_query)


async def request_password_reset(db: AsyncSession, email: str) -> None:
    """Issue a single-use reset token for the email and send the reset link

    The caller always reports success so the endpoint never reveals whether an email is
    registered, an unknown address simply returns after pruning expired tokens

    Args:
        db: Active database session
        email: Email address requesting the reset
    """
    user_id = await find_user_id_by_email(db, email)
    await delete_expired_password_reset_tokens(db)
    if user_id is None:
        await db.commit()
        return

    # A new request supersedes any earlier link, so only the latest token stays valid
    await db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id))

    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    expires_at = datetime.now(UTC) + timedelta(seconds=PASSWORD_RESET_TOKEN_EXPIRE_SECONDS)
    db.add(PasswordResetToken(user_id=user_id, token_hash=hash_token(raw_token), expires_at=expires_at))
    await db.commit()

    # The raw token only ever leaves the server inside the emailed link
    reset_link = f"{APP_URL}{_RESET_PATH}?token={raw_token}"
    expiry_minutes = PASSWORD_RESET_TOKEN_EXPIRE_SECONDS // 60
    message = render_reset_email(reset_link, expiry_minutes)
    await get_email_sender().send(email, message)


async def _find_active_reset_token(db: AsyncSession, token: str) -> PasswordResetToken | None:
    """Return the unused, unexpired reset token row matching the raw token, if any"""
    reset_token_query = select(PasswordResetToken).where(
        PasswordResetToken.token_hash == hash_token(token),
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > sa_func.now(),
    )
    return (await db.execute(reset_token_query)).scalar_one_or_none()


async def ensure_reset_token_active(db: AsyncSession, token: str) -> None:
    """Check a reset token is still redeemable without consuming anything

    The verify step burns its single-use challenge before touching the token, so this pre-check
    keeps a stale token from wasting a live challenge

    Args:
        db: Active database session
        token: Raw reset token from the emailed link

    Raises:
        HTTPException: The token is unknown, already used, or expired
    """
    if await _find_active_reset_token(db, token) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)


async def begin_password_reset(db: AsyncSession, token: str, new_password: str) -> ResetSecondFactorRequired | None:
    """Reset the password from a valid token, or issue a challenge when a second factor is active

    Possession of the emailed token proves the email step, so accounts without a second factor
    reset immediately. Any confirmed factor, or a pending re-enrolment, holds the reset behind the
    same second-factor step as login, scoped to the reset flow

    Args:
        db: Active database session
        token: Raw reset token from the emailed link
        new_password: Replacement password already validated against the policy

    Returns:
        The issued challenge when a second factor must verify first, otherwise None

    Raises:
        HTTPException: The token is unknown, already used, or expired
    """
    reset_token = await _find_active_reset_token(db, token)
    if reset_token is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    # The validated token proves this identity, which the self-only users policy needs stamped
    current_user_id_ctx.set(reset_token.user_id)

    totp_enabled = await is_totp_enabled(db, reset_token.user_id)
    passkey_available = await is_passkey_registered(db, reset_token.user_id)
    user = await db.get(User, reset_token.user_id)
    if totp_enabled or passkey_available or (user is not None and user.second_factor_reenrollment_required):
        mfa_token = await issue_mfa_challenge(db, reset_token.user_id, MFA_PURPOSE_PASSWORD_RESET)
        return ResetSecondFactorRequired(
            mfa_token=mfa_token,
            totp_enabled=totp_enabled,
            passkey_available=passkey_available,
        )

    await _apply_password_reset(db, reset_token, new_password)
    return None


async def complete_password_reset(db: AsyncSession, user_id: uuid.UUID, token: str, new_password: str) -> None:
    """Reset the password after the second factor verified for the same user

    Args:
        db: Active database session
        user_id: User the verified challenge belongs to
        token: Raw reset token from the emailed link
        new_password: Replacement password already validated against the policy

    Raises:
        HTTPException: The token is invalid or belongs to a different user than the challenge
    """
    reset_token = await _find_active_reset_token(db, token)

    # The token and the verified challenge must name the same account, so a challenge for one
    # account can never redeem a reset link issued to another
    if reset_token is None or reset_token.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    await _apply_password_reset(db, reset_token, new_password)


async def _apply_password_reset(db: AsyncSession, reset_token: PasswordResetToken, new_password: str) -> None:
    """Redeem the reset token, set the new password, and revoke every session

    Args:
        db: Active database session
        reset_token: Active reset token row being redeemed
        new_password: Replacement password already validated against the policy

    Raises:
        HTTPException: The token was already redeemed or the account has no password credential
    """
    # Claim the token in one conditional update so concurrent redemptions cannot both succeed
    claim_query = (
        update(PasswordResetToken)
        .where(PasswordResetToken.id == reset_token.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=datetime.now(UTC))
    )
    claimed = await db.execute(claim_query)
    if claimed.rowcount != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == reset_token.user_id)
    credential = (await db.execute(credential_query)).scalar_one_or_none()
    if credential is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    # A verified reset clears any login lockout the user was trying to recover from
    credential.password_hash = hash_password(new_password)
    credential.password_algo = "argon2id"  # noqa: S105
    credential.failed_attempt_count = 0
    credential.locked_until = None

    # A reset means the old password may be compromised, so end every session
    await delete_all_user_auth_sessions(db, reset_token.user_id)
    await db.commit()
