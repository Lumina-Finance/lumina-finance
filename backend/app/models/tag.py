"""Tag and transaction tag models"""

import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Tag(Base):
    """Tag registry for cross-cutting transaction analysis beyond categories."""

    __tablename__ = "tags"
    __table_args__ = (
        # Both are built on the name with capitals folded, so the database refuses the pair the
        # routes refuse: Travel beside travel in one scope
        # Personal tags: unique per user (only when not group-scoped)
        Index(
            "uq_tag_owner_name",
            "owner_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("group_id IS NULL"),
        ),
        # Group tags: unique per group, as an index rather than a unique constraint, which cannot
        # be written against an expression
        Index(
            "uq_tag_group_name",
            "group_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("group_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TransactionTag(Base):
    """Junction table linking transactions to tags."""

    __tablename__ = "transaction_tags"

    transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tags.id"), primary_key=True)
