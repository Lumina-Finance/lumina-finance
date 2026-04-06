import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, DateTime, ForeignKey, Index, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Merchant(Base):
    """Merchant registry — stores, employers, people, or anything that sends/receives money."""

    __tablename__ = "merchants"
    __table_args__ = (
        # Personal merchants: unique per user (only when not household-scoped)
        Index(
            "uq_merchant_owner_name", "owner_id", "name",
            unique=True, postgresql_where=text("household_id IS NULL"),
        ),
        # Household merchants: unique per household
        UniqueConstraint("household_id", "name", name="uq_merchant_household_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    household_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))  # Auto-categorization hint
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
