"""Merchant model"""

import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, Boolean, CheckConstraint, DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Merchant(Base):
    """Merchant registry: stores, employers, people, or anything that sends or receives money."""

    __tablename__ = "merchants"
    __table_args__ = (
        # The same three scopes categories carry: owned by nobody when it ships with the app,
        # otherwise by exactly one of a user or a group
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
            )
            """,
            name="ck_merchants_scope",
        ),
        # All three are built on the name with capitals folded, so the database refuses the pair
        # the routes refuse: Amazon beside AMAZON in one scope. Surrounding spaces are trimmed on
        # the way in instead, so the stored name is already what these compare
        # Personal merchants: unique per user (only when not group-scoped)
        Index(
            "uq_merchant_owner_name", "owner_id", text("lower(name)"),
            unique=True, postgresql_where=text("group_id IS NULL"),
        ),
        # Group merchants: unique per group, as an index rather than a unique constraint, which
        # cannot be written against an expression
        Index(
            "uq_merchant_group_name", "group_id", text("lower(name)"),
            unique=True, postgresql_where=text("group_id IS NOT NULL"),
        ),
        # One merchant per name across the whole app, so a second Myself cannot be seeded
        Index(
            "uq_merchant_system_name", text("lower(name)"),
            unique=True, postgresql_where=text("is_system = true"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))  # Null on system merchants
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)

    # Ships with the app and belongs to everyone, so it cannot be renamed, deleted, or given a
    # default category, which lives on the merchant and would otherwise be shared by every user
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))  # Auto-categorization hint
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
