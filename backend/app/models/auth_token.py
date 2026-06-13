"""Authentication token allowlist model"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AuthTokenKind, Base


class AuthToken(Base):
    """Represents one active access or refresh token"""

    __tablename__ = "auth_tokens"
    __table_args__ = (
        UniqueConstraint("session_id", "token_kind", name="uq_auth_token_session_kind"),
    )

    jti: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    token_kind: Mapped[AuthTokenKind] = mapped_column(nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
