"""Category model"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CategoryKind


class Category(Base):
    """Flat transaction categories across system, personal, and group scopes."""

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint(
            """
            (
                is_system = true
                AND owner_id IS NULL
                AND group_id IS NULL
            )
            OR (
                is_system = false
                AND owner_id IS NOT NULL
                AND group_id IS NULL
            )
            OR (
                is_system = false
                AND owner_id IS NULL
                AND group_id IS NOT NULL
            )
            """,
            name="ck_categories_scope",
        ),
        Index(
            "uq_category_system_name", "name",
            unique=True, postgresql_where=text("is_system = true"),
        ),
        Index(
            "uq_category_owner_name", "owner_id", "name",
            unique=True, postgresql_where=text("owner_id IS NOT NULL AND group_id IS NULL"),
        ),
        Index(
            "uq_category_group_name", "group_id", "name",
            unique=True, postgresql_where=text("group_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[CategoryKind] = mapped_column(nullable=False)
    icon: Mapped[str | None] = mapped_column(Text)  # Emoji glyph rendered by the client.
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
