"""User model"""

import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, Boolean, DateTime, Float, ForeignKey, Text, func
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
    runway_risky_below_months: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1")
    runway_healthy_at_months: Mapped[float] = mapped_column(Float, nullable=False, default=3.0, server_default="3")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Set when a recovery-code login wipes every factor, forcing re-enrolment before the account unlocks
    second_factor_reenrollment_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )


class UserRunwayAccount(Base):
    """User's picked liquid accounts that feed the runway calculation on the dashboard."""

    __tablename__ = "user_runway_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
