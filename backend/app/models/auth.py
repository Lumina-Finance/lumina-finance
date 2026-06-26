"""Authentication identity and credential models"""

import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, Boolean, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AuthProvider, Base


class AuthIdentity(Base):
    """Links a user to an authentication provider. Supports multiple providers per user."""

    __tablename__ = "auth_identities"
    __table_args__ = (
        UniqueConstraint("user_id", "auth_provider", name="uq_auth_identity_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    auth_provider: Mapped[AuthProvider] = mapped_column(nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PasswordCredential(Base):
    """Stores password hashes. One-to-one with users (only exists when auth provider is password)."""

    __tablename__ = "password_credentials"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    password_algo: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)  # e.g., "argon2id"
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    failed_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # Reset to 0 on successful login
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # Non-null = temporarily locked


class TotpCredential(Base):
    """Stores a user's TOTP secret encrypted at rest, one-to-one and pending until confirmed"""

    __tablename__ = "totp_credentials"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # Non-null once a code is verified
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class RecoveryCode(Base):
    """Stores one-time 2FA recovery codes as hashes, deleted when redeemed"""

    __tablename__ = "recovery_codes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Only the hash is stored so a leaked table cannot be used as a second factor
    code_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class PasswordResetToken(Base):
    """Stores single-use password reset tokens as hashes, scoped per user and expiring."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Only the hash is stored so a leaked table cannot be used to reset accounts
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # Non-null once redeemed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MfaChallenge(Base):
    """Stores single-use second-factor challenges issued after a verified password, keyed by jti and expiring"""

    __tablename__ = "mfa_challenges"

    jti: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
