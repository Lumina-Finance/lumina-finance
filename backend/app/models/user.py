"""User model"""

import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.preferences import ACTION_KEYS, DATE_FORMATS, DEFAULT_ACTION_KEY, DEFAULT_DATE_FORMAT

DATE_FORMAT_MAX_LENGTH = 32
ACTION_KEY_MAX_LENGTH = 32

_DATE_FORMAT_CHECK_VALUES = ", ".join(f"'{value}'" for value in DATE_FORMATS)
_ACTION_KEY_CHECK_VALUES = ", ".join(f"'{value}'" for value in ACTION_KEYS)


class User(Base):
    """Core user profile. Every user has exactly one row here."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(f"date_format IN ({_DATE_FORMAT_CHECK_VALUES})", name="ck_users_date_format"),
        CheckConstraint(f"action_key IN ({_ACTION_KEY_CHECK_VALUES})", name="ck_users_action_key"),
        # An address is one account whatever the capitals of its letters A to Z. The lookups in
        # app.db.rls.functions and app.services.auth.user_lookup.fold_email fold the same way
        Index("uq_users_email_lower", text('lower(email COLLATE "C")'), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(VARCHAR(254), nullable=False)  # RFC 3696
    first_name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    last_name: Mapped[str | None] = mapped_column(VARCHAR(256))
    profile_pic: Mapped[str | None] = mapped_column(Text)  # Path/URL to profile picture
    tz: Mapped[str] = mapped_column(VARCHAR(40), nullable=False)  # IANA timezone (e.g., "America/Toronto"), auto-derived from device
    base_currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    runway_risky_below_months: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1")
    runway_healthy_at_months: Mapped[float] = mapped_column(Float, nullable=False, default=3.0, server_default="3")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Fits the longest date format name with room for later formats
    date_format: Mapped[str] = mapped_column(
        VARCHAR(DATE_FORMAT_MAX_LENGTH), nullable=False, default=DEFAULT_DATE_FORMAT, server_default=DEFAULT_DATE_FORMAT
    )

    action_key: Mapped[str] = mapped_column(
        VARCHAR(ACTION_KEY_MAX_LENGTH), nullable=False, default=DEFAULT_ACTION_KEY, server_default=DEFAULT_ACTION_KEY
    )

    # Set when a recovery-code login wipes every factor, forcing re-enrolment before the account unlocks
    second_factor_reenrollment_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class UserCreditExcludedAccount(Base):
    """An account the user left out of the dashboard credit widget's utilization

    The accounts left out are stored rather than the ones counted, so every credit account counts
    until left out, including one added later. A row for an account the user can no longer see is
    kept and ignored, so the choice returns if they regain access
    """

    __tablename__ = "user_credit_excluded_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)


class UserRunwayAccount(Base):
    """User's picked liquid accounts that feed the runway calculation on the dashboard."""

    __tablename__ = "user_runway_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
