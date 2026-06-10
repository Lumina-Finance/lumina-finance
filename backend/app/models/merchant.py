"""Merchant model"""

import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, DateTime, ForeignKey, Index, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Merchant(Base):
    """Merchant registry — stores, employers, people, or anything that sends/receives money."""

    __tablename__ = "merchants"
    __table_args__ = (
        # Personal merchants: unique per user (only when not group-scoped)
        Index(
            "uq_merchant_owner_name", "owner_id", "name",
            unique=True, postgresql_where=text("group_id IS NULL"),
        ),
        # Group merchants: unique per group
        UniqueConstraint("group_id", "name", name="uq_merchant_group_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))  # Auto-categorization hint
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
