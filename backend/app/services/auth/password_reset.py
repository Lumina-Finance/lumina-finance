"""Password reset request and token service"""

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import APP_URL, PASSWORD_RESET_TOKEN_EXPIRE_SECONDS
from app.models.auth import PasswordCredential, PasswordResetToken
from app.services.auth.password_helpers import hash_password
from app.services.auth.sessions import delete_all_user_auth_sessions
from app.services.auth.token_hashing import hash_token
from app.services.auth.user_lookup import find_user_id_by_email
from app.services.email import RenderedEmail, get_email_sender

# 32 random bytes give a 256-bit token, infeasible to guess so a fast hash resists leaks
_TOKEN_BYTES = 32
_RESET_PATH = "/reset-password"
_RESET_EMAIL_SUBJECT = "Reset your password"


def _build_reset_email_body(reset_link: str, expiry_minutes: int) -> str:
    """Return the plain-text reset email carrying the one-time link"""
    return (
        "We received a request to reset your password.\n\n"
        f"Use this link within {expiry_minutes} minutes to choose a new password:\n"
        f"{reset_link}\n\n"
        "If you did not request this, you can ignore this email"
    )


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
    message = RenderedEmail(subject=_RESET_EMAIL_SUBJECT, text_body=_build_reset_email_body(reset_link, expiry_minutes))
    await get_email_sender().send(email, message)


async def reset_password(db: AsyncSession, token: str, new_password: str) -> None:
    """Set a new password from a valid reset token and revoke every session

    Args:
        db: Active database session
        token: Raw reset token from the emailed link
        new_password: Replacement password already validated against the policy

    Raises:
        HTTPException: The token is unknown, already used, or expired
    """
    reset_token_query = select(PasswordResetToken).where(
        PasswordResetToken.token_hash == hash_token(token),
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > sa_func.now(),
    )
    reset_token = (await db.execute(reset_token_query)).scalar_one_or_none()
    if reset_token is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == reset_token.user_id)
    credential = (await db.execute(credential_query)).scalar_one_or_none()
    if credential is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    # A verified reset clears any login lockout the user was trying to recover from
    credential.password_hash = hash_password(new_password)
    credential.password_algo = "argon2id"  # noqa: S105
    credential.failed_attempt_count = 0
    credential.locked_until = None
    reset_token.used_at = datetime.now(UTC)

    # A reset means the old password may be compromised, so end every session
    await delete_all_user_auth_sessions(db, reset_token.user_id)
    await db.commit()
