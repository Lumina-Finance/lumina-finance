import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CategoryKind


class Category(Base):
    """Flat transaction categories. A default set is seeded for every new user on signup."""

    __tablename__ = "categories"
    __table_args__ = (
        # Personal categories: unique per user (only when not group-scoped)
        Index(
            "uq_category_owner_name_kind", "owner_id", "name", "kind",
            unique=True, postgresql_where=text("group_id IS NULL"),
        ),
        # Group categories: unique per group
        UniqueConstraint("group_id", "name", "kind", name="uq_category_group_name_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)  # Creator/owner
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[CategoryKind] = mapped_column(nullable=False)
    icon: Mapped[str | None] = mapped_column(Text)  # Emoji glyph rendered by the client.
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
