"""Cache state timestamp models"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserCacheState(Base):
    """Latest app-data change timestamp for one user's personal scope."""

    __tablename__ = "user_cache_states"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_changed_session_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    # When bank sync last changed what the user's pages show while leaving their ledger as it was,
    # such as a sync's progress, the items it brought for review or a listing the link flow asked
    # for. Pages read the later of the two times, while undoing an import compares its save with
    # changed_at alone, so a sync that leaves the ledger alone doesn't make the import permanent
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GroupCacheState(Base):
    """Latest app-data change timestamp for one shared group scope."""

    __tablename__ = "group_cache_states"

    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_changed_session_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)


class SharedCacheState(Base):
    """Latest change to data every user sees, such as an institution

    Holds one row. A request can write only the caller's own marker under row-level security,
    so a change every user must see needs a row every signed-in user may write
    """

    __tablename__ = "shared_cache_state"

    # Always true, and the key, so a second row can't exist
    id: Mapped[bool] = mapped_column(Boolean, primary_key=True, default=True, server_default=true())
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (CheckConstraint("id", name="ck_shared_cache_state_single_row"),)
