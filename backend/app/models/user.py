"""User model"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import VARCHAR, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.preferences import DATE_FORMATS, DEFAULT_DATE_FORMAT

DATE_FORMAT_MAX_LENGTH = 32

_DATE_FORMAT_CHECK_VALUES = ", ".join(f"'{value}'" for value in DATE_FORMATS)


class User(Base):
    """Core user profile. Every user has exactly one row here."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(f"date_format IN ({_DATE_FORMAT_CHECK_VALUES})", name="ck_users_date_format"),
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

    # Set when a recovery-code login wipes every factor, forcing re-enrolment before the account unlocks
    second_factor_reenrollment_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # Number of the key a browser encrypts its saved copy of this user's data with. Raised by
    # rotate_saved_copy_key whenever the server ends the user's other sessions, so every copy saved
    # under an earlier number becomes unreadable. The key itself is derived from the number, never stored
    saved_copy_key_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # Set when the user asks to delete their profile, and the profile is marked from then on. A marked
    # profile syncs nothing and every route but the one that cancels refuses it. With no due time the
    # same request has already deleted every bank connection and signed the user out for good, and
    # app.services.profile_deletion removes their data and then this row. With a due time the user can
    # still sign in until then, only to cancel, and the bank connections stay
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # When a marked profile's data may start to go, set when a waiting period applies. None on a marked
    # profile means it goes at once. Cancelling the deletion clears it with the mark
    deletion_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # When the reminder of a waiting profile's deletion was sent, so it goes at most once. Cleared with the mark
    deletion_reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def is_waiting_to_be_deleted(self) -> bool:
        """Whether the profile is marked and its due time is still ahead, so its owner can cancel the deletion"""
        return self.deletion_requested_at is not None and self.deletion_due_at is not None and self.deletion_due_at > datetime.now(UTC)


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


class UserLastSignIn(Base):
    """When a user last signed in or renewed a session, one row per user once they first do

    Kept apart from the user row because a renewal writes it while holding its session row, and ending
    a user's other sessions holds the user row while it deletes sessions, so a write to the user row
    there could deadlock with it. Nothing else locks this row
    """

    __tablename__ = "user_last_sign_ins"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    last_signed_in_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
