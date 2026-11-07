"""Bank holds: booked records of no amount, kept apart from review and the ledger"""

import uuid
from datetime import date, datetime

from sqlalchemy import VARCHAR, Date, DateTime, ForeignKey, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BankHold(Base):
    """A booked bank record of exactly zero. It has no amount to review or to put in the ledger

    Banks send these for authorisation checks and card holds. A zero amount can't be approved, so
    the record is listed for awareness and kept out of the review inbox, the ledger and every
    balance. A sync keeps an account's holds to what the bank reports within the days it fetched, so
    one the bank dropped, reported removed or gave an amount to goes away. Dismissing a hold stamps
    it rather than deleting it, so the same bank ID reported again doesn't come back
    """

    __tablename__ = "bank_holds"
    __table_args__ = (
        # The same identity a bank transaction is known by, so one record is one hold
        UniqueConstraint(
            "account_id",
            "provider",
            "external_account_id",
            "external_transaction_hash",
            name="uq_bank_holds_identity",
        ),
        # Serves listing and pruning one account's holds
        Index("ix_bank_holds_account_id", "account_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)
    external_account_id: Mapped[str] = mapped_column(Text, nullable=False)

    # The keyed hash of the provider's transaction ID, as bank transactions keep it
    external_transaction_hash: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    hold_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Set when the user dismissed it. That keeps it from being listed or stored again
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
