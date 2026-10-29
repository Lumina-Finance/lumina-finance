"""Transaction link model"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TransactionLink(Base):
    """A refund tied to the expense it refunds.

    A link changes no balance, total, budget or insight. It is directed, so the transaction a user
    sees as "Refund of" and the one they see as "Refunds" never swap. A refund refunds one
    expense, and an expense may have many refunds, such as two partial ones. Deleting either
    transaction removes the link
    """

    __tablename__ = "transaction_links"
    __table_args__ = (
        # Refuses a transaction linked to itself
        CheckConstraint("refund_transaction_id <> original_transaction_id", name="ck_transaction_links_distinct"),
        # Holds each refund to one expense, and indexes lookups from the refund
        UniqueConstraint("refund_transaction_id", name="uq_transaction_links_refund"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    refund_transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Indexed for lookups from the original, which the refund's unique constraint does not serve
    original_transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
