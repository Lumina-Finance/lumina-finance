"""Institution submission model"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InstitutionSubmission(Base):
    """Who added an institution to the shared list

    Kept apart from the institution, which every user reads, so that only the person who added it
    can read who did. An institution added before submissions were recorded has none
    """

    __tablename__ = "institution_submissions"

    # An institution has one adder, and deleting the institution removes the record of who added it
    institution_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
