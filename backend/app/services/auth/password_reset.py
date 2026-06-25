"""Password reset request and token service"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import APP_URL, PASSWORD_RESET_TOKEN_EXPIRE_SECONDS
from app.models.auth import PasswordResetToken
from app.services.auth.user_lookup import find_user_id_by_email
from app.services.email import send_email

# 32 random bytes give a 256-bit token, infeasible to guess so a fast hash resists leaks
_TOKEN_BYTES = 32
_RESET_PATH = "/reset-password"
_RESET_EMAIL_SUBJECT = "Reset your password"


def _hash_reset_token(raw_token: str) -> str:
    """Return the SHA-256 hex digest stored for a reset token

    The token is high-entropy random, so a fast hash resists a database leak without the
    per-request cost of the Argon2 hashing used for user-chosen passwords
    """
    return hashlib.sha256(raw_token.encode()).hexdigest()


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
    db.add(PasswordResetToken(user_id=user_id, token_hash=_hash_reset_token(raw_token), expires_at=expires_at))
    await db.commit()

    # The raw token only ever leaves the server inside the emailed link
    reset_link = f"{APP_URL}{_RESET_PATH}?token={raw_token}"
    expiry_minutes = PASSWORD_RESET_TOKEN_EXPIRE_SECONDS // 60
    await send_email(email, _RESET_EMAIL_SUBJECT, _build_reset_email_body(reset_link, expiry_minutes))
