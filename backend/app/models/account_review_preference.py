"""Per-account trust choices for bank data"""

import enum
import uuid

from sqlalchemy import VARCHAR, CheckConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, check_values


class ReviewDecision(enum.StrEnum):
    """Whether a kind of bank observation waits for the user or is applied straight away"""

    REVIEW = "review"
    TRUST = "trust"


_DECISIONS = check_values(ReviewDecision)


class AccountReviewPreference(Base):
    """An account's three trust choices, kept whichever bank account or provider it follows

    An account with no row reads as Review all, so accounts that existed before bank sync need
    no backfill. A changed choice applies to later observations only
    """

    __tablename__ = "account_review_preferences"
    __table_args__ = (
        CheckConstraint(f"new_transactions IN ({_DECISIONS})", name="ck_account_review_preferences_new_transactions"),
        CheckConstraint(f"corrections IN ({_DECISIONS})", name="ck_account_review_preferences_corrections"),
        CheckConstraint(f"removals IN ({_DECISIONS})", name="ck_account_review_preferences_removals"),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)

    # Repeated from the account so the row-level security policy compares a column on this table
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Stored as the user sets it, though in this release new bank items wait for review whatever it
    # says, since nothing fills in their merchant and category until the classifier ships
    new_transactions: Mapped[str] = mapped_column(
        VARCHAR(8),
        nullable=False,
        default=ReviewDecision.REVIEW,
        server_default=ReviewDecision.REVIEW.value,
    )
    corrections: Mapped[str] = mapped_column(
        VARCHAR(8),
        nullable=False,
        default=ReviewDecision.REVIEW,
        server_default=ReviewDecision.REVIEW.value,
    )
    removals: Mapped[str] = mapped_column(
        VARCHAR(8),
        nullable=False,
        default=ReviewDecision.REVIEW,
        server_default=ReviewDecision.REVIEW.value,
    )
