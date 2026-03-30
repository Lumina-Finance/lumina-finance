import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Merchant(Base):
    """Per-user merchant registry — stores, employers, people, or anything that sends/receives money."""

    __tablename__ = "merchants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))  # Auto-categorization hint
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
