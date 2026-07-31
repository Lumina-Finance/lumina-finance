"""Transaction model"""

import uuid
from datetime import date, datetime

from sqlalchemy import VARCHAR, BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TransferOtherAccountScope


class Transaction(Base):
    """Core ledger: positive amount = inflow, negative = outflow. Transfers are two independent rows."""

    __tablename__ = "transactions"
    __table_args__ = (
        # Null-safe on both sides, so an account recorded without a scope is rejected rather
        # than passing on an unknown comparison
        CheckConstraint(
            "(other_account_id IS NOT NULL) = (other_account_scope IS NOT DISTINCT FROM 'TRACKED')",
            name="ck_transactions_other_account_scope_matches_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)  # Audit trail
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    dt: Mapped[date] = mapped_column(Date, nullable=False)
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("merchants.id"), index=True)  # Null for transfers
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # In currency base units
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    fx_rate: Mapped[float | None] = mapped_column(Numeric)  # Exchange rate to account currency
    notes: Mapped[str | None] = mapped_column(Text)

    # The account on the other side of a transfer. Recording it creates no transaction there and
    # moves no balance, so deleting that account must leave this row alone rather than cascade
    other_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="RESTRICT"), index=True,
    )
    other_account_scope: Mapped[TransferOtherAccountScope | None] = mapped_column()

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
