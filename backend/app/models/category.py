import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CategoryKind


class Category(Base):
    """Hierarchical transaction categories. App seeds a default 'Uncategorized' category per kind per user."""

    __tablename__ = "categories"
    __table_args__ = (
        # Personal categories: unique per user (only when not household-scoped)
        Index(
            "uq_category_owner_name_kind", "owner_id", "name", "kind",
            unique=True, postgresql_where=text("household_id IS NULL"),
        ),
        # Household categories: unique per household
        UniqueConstraint("household_id", "name", "kind", name="uq_category_household_name_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)  # Creator/owner
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[CategoryKind] = mapped_column(nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))  # Null = top-level
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
