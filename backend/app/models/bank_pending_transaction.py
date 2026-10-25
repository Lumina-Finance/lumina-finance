"""Pending bank transactions, kept for display only"""

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BankPendingTransaction(Base):
    """A transaction the bank hasn't posted yet, shown beside an account but never in the ledger

    Nothing reads these for balances, budgets, reports or insights, and they never enter review.
    An account's set is replaced wholesale by each sync that fetches today, so an item that posted
    or was dropped disappears without being matched to anything
    """

    __tablename__ = "bank_pending_transactions"
    __table_args__ = (
        # An amount the account currency can't hold exactly is kept as the bank wrote it
        CheckConstraint("(amount IS NULL) <> (raw_amount IS NULL)", name="ck_bank_pending_transactions_amount"),
        # Serves replacing and listing one account's set
        Index("ix_bank_pending_transactions_account_id", "account_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)

    # In the account currency's minor units, or null with the amount exactly as the bank sent it
    amount: Mapped[int | None] = mapped_column(BigInteger)
    raw_amount: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
