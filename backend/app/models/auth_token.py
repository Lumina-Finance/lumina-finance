"""Authentication token allowlist model"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AuthTokenKind, Base


class AuthToken(Base):
    """Represents one active access or refresh token"""

    __tablename__ = "auth_tokens"
    __table_args__ = (
        CheckConstraint(
            "token_kind = 'REFRESH' OR refresh_grace_expires_at IS NULL",
            name="ck_auth_token_refresh_grace_kind",
        ),
        Index(
            "uq_auth_token_session_access",
            "session_id",
            unique=True,
            postgresql_where=text("token_kind = 'ACCESS'"),
        ),
        Index(
            "uq_auth_token_session_current_refresh",
            "session_id",
            unique=True,
            postgresql_where=text("token_kind = 'REFRESH' AND refresh_grace_expires_at IS NULL"),
        ),
        Index(
            "uq_auth_token_session_previous_refresh",
            "session_id",
            unique=True,
            postgresql_where=text("token_kind = 'REFRESH' AND refresh_grace_expires_at IS NOT NULL"),
        ),
    )

    jti: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    token_kind: Mapped[AuthTokenKind] = mapped_column(nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    refresh_grace_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
