from sqlalchemy import SmallInteger, Text, VarChar
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Currency(Base):
    """Reference table of supported currencies, seeded with ISO 4217 data."""

    __tablename__ = "currencies"

    id: Mapped[str] = mapped_column(VarChar(3), primary_key=True)  # ISO 4217 code (e.g., CAD, USD, JPY)
    name: Mapped[str] = mapped_column(Text, nullable=False)  # Full name in singular (e.g., "Canadian Dollar")
    symbol: Mapped[str] = mapped_column(VarChar(8), nullable=False)
    minor_unit_exponent: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # e.g., CAD=2, JPY=0, BHD=3
