import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ActiveToken(Base):
    """Tracks all issued tokens. Only tokens present in this table are considered valid."""

    __tablename__ = "active_tokens"

    jti: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # JWT ID from the token's jti claim
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Groups the access + refresh pair issued together so logout/refresh rotation can act on the whole session.
    session_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)  # Token's original expiry
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
