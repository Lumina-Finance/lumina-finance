import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Group(Base):
    """A shared financial group (e.g., a couple, family, roommates)."""

    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str | None] = mapped_column(Text)
    profile_pic: Mapped[str | None] = mapped_column(Text)  # Path/URL to group picture
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class GroupMember(Base):
    """Junction table linking users to groups."""

    __tablename__ = "group_members"

    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
