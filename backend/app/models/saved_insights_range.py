"""Saved insights range model"""

import uuid
from datetime import datetime

from sqlalchemy import (
    VARCHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    SmallInteger,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Relative window units a saved range can step back by, ordered shortest to longest
SAVED_INSIGHTS_RANGE_UNITS = ("day", "week", "month", "quarter", "year")

_UNIT_CHECK_VALUES = ", ".join(f"'{unit}'" for unit in SAVED_INSIGHTS_RANGE_UNITS)


class SavedInsightsRange(Base):
    """A user's named relative date window for the insights page

    Stores the window as an amount and unit, for example three months, rather than fixed
    dates, so applying a saved range always recomputes against the current day.
    """

    __tablename__ = "saved_insights_ranges"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_saved_insights_range_user_name"),
        CheckConstraint("amount > 0", name="ck_saved_insights_range_amount_positive"),
        CheckConstraint(f"unit IN ({_UNIT_CHECK_VALUES})", name="ck_saved_insights_range_unit"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    amount: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    unit: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
