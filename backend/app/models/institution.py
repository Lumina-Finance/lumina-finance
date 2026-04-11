import uuid

from sqlalchemy import VARCHAR, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, InstitutionStatus


class Institution(Base):
    """Global registry of financial institutions (banks, brokerages, etc.)."""

    __tablename__ = "institutions"
    __table_args__ = (
        UniqueConstraint("name", "country_code", name="uq_institution_name_country"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    status: Mapped[InstitutionStatus] = mapped_column(nullable=False, default=InstitutionStatus.PENDING)
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    country_code: Mapped[str] = mapped_column(VARCHAR(2), nullable=False)  # ISO 3166-1 alpha-2
    website: Mapped[str] = mapped_column(Text, nullable=False)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
