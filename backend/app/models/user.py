import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class User(Base):
    """Core user profile. Every user has exactly one row here."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(VARCHAR(254), unique=True, nullable=False)  # RFC 3696
    first_name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    last_name: Mapped[str | None] = mapped_column(VARCHAR(256))
    profile_pic: Mapped[str | None] = mapped_column(Text)  # Path/URL to profile picture
    tz: Mapped[str] = mapped_column(VARCHAR(40), nullable=False)  # IANA timezone (e.g., "America/Toronto"), auto-derived from device
    base_currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False)
