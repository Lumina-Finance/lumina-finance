import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, DateTime, ForeignKey, Index, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Tag(Base):
    """Tag registry for cross-cutting transaction analysis beyond categories."""

    __tablename__ = "tags"
    __table_args__ = (
        # Personal tags: unique per user (only when not group-scoped)
        Index(
            "uq_tag_owner_name", "owner_id", "name",
            unique=True, postgresql_where=text("group_id IS NULL"),
        ),
        # Group tags: unique per group
        UniqueConstraint("group_id", "name", name="uq_tag_group_name"),
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
