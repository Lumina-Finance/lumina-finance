import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Tag(Base):
    """Per-user tag registry for cross-cutting transaction analysis beyond categories."""

    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_tag_owner_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TransactionTag(Base):
    """Junction table linking transactions to tags."""

    __tablename__ = "transaction_tags"

    transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tags.id"), primary_key=True)
