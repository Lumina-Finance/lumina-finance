"""Booked bank transactions and their review state"""

import enum
import uuid
from datetime import date, datetime
from typing import Any, ClassVar, Literal

from sqlalchemy import VARCHAR, BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.bank_connection import PROVIDER_ID_MAX_LENGTH, provider_id_check
from app.models.base import Base, check_values


class BankTransactionDisposition(enum.StrEnum):
    """What the user decided about a booked bank transaction"""

    AWAITING_REVIEW = "awaiting_review"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"


class OpenReviewKind(enum.StrEnum):
    """A review item opened on an accepted bank transaction by a later provider observation"""

    CORRECTION = "correction"
    REMOVAL = "removal"


# The bank fields a ledger row can differ from. The ledger has no description column, so the raw
# bank description is always shown read-only and can't be edited
EditableBankField = Literal["date", "amount"]

# The fields whose change opens a correction on an accepted record
CorrectableBankField = Literal["date", "amount", "description"]

# The JSON columns store None as SQL NULL rather than a JSON null, since the checks below read a
# missing value as NULL
_JSON = JSONB(none_as_null=True)


# Every column a provider observation fills. A dismissed record keeps none of them
OBSERVATION_COLUMNS = (
    "observed_date",
    "observed_amount",
    "raw_amount",
    "description",
    "observed_at",
)


class BankTransaction(Base):
    """One distinct booked transaction a provider reported for an account

    The identity namespaces the provider's transaction ID by the account, the provider and
    the bank account, so imports never duplicate and decisions survive unlinking and disconnecting.
    The record's ID is also its review item's, so it has at most one open item: a new item while it
    awaits review, or a correction or removal once accepted. An item the provider withdraws before
    the user decides is deleted, so the same transaction can return later as a new import, and so is
    an accepted one whose ledger row is deleted
    """

    __tablename__ = "bank_transactions"
    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "provider",
            "external_account_id",
            "external_transaction_hash",
            name="uq_bank_transactions_identity",
        ),
        # A ledger row comes from at most one bank transaction
        UniqueConstraint("transaction_id", name="uq_bank_transactions_transaction_id"),
        provider_id_check("bank_transactions"),
        CheckConstraint(
            f"disposition IN ({check_values(BankTransactionDisposition)})",
            name="ck_bank_transactions_disposition",
        ),
        CheckConstraint(f"open_kind IN ({check_values(OpenReviewKind)})", name="ck_bank_transactions_open_kind"),
        # Accepted means exactly one ledger row, aligned with a bank date
        CheckConstraint(
            "(disposition = 'accepted') = (transaction_id IS NOT NULL) AND (disposition = 'accepted') = (aligned_date IS NOT NULL)",
            name="ck_bank_transactions_accepted",
        ),
        # Only an accepted record has ledger values to align with, a description kept, a correction or
        # removal to review, or a removal reported
        CheckConstraint(
            "disposition = 'accepted' OR (aligned_amount IS NULL AND open_kind IS NULL AND previous_values IS NULL "
            "AND declined_observation IS NULL AND removed_at IS NULL AND kept_description IS NULL)",
            name="ck_bank_transactions_review_state",
        ),
        # A removal is reviewed only once the provider has reported it
        CheckConstraint("open_kind <> 'removal' OR removed_at IS NOT NULL", name="ck_bank_transactions_removal"),
        # A record still in play holds the bank's values, with an amount stored either exactly or as sent
        CheckConstraint(
            "disposition = 'dismissed' OR (observed_date IS NOT NULL AND description IS NOT NULL "
            "AND observed_at IS NOT NULL AND (observed_amount IS NULL) <> (raw_amount IS NULL))",
            name="ck_bank_transactions_observation",
        ),
        # A dismissed record keeps only its identity, enough to stay dismissed when the bank resends it
        CheckConstraint(
            "disposition <> 'dismissed' OR (" + " AND ".join(f"{column} IS NULL" for column in OBSERVATION_COLUMNS) + ")",
            name="ck_bank_transactions_dismissed",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(VARCHAR(PROVIDER_ID_MAX_LENGTH), nullable=False)
    external_account_id: Mapped[str] = mapped_column(Text, nullable=False)

    # The keyed hash of the provider's ID for the transaction. The server's key keeps anything of the ID
    # out of it. See app.services.bank_sync.transaction_hash
    external_transaction_hash: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    disposition: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)

    # Deleting the ledger row deletes the record, leaving no marker of its bank identity
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"))

    # The provider's latest observation. The amount is in the account currency's minor units, or
    # null with the amount exactly as the bank sent it when that can't be stored exactly
    observed_date: Mapped[date | None] = mapped_column(Date)
    observed_amount: Mapped[int | None] = mapped_column(BigInteger)
    raw_amount: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The bank date and amount the ledger row was last aligned with, as the ledger holds them. A
    # field is edited while the ledger differs from these. The amount is null when the bank's
    # couldn't be stored and the user entered one. That counts as edited
    aligned_date: Mapped[date | None] = mapped_column(Date)
    aligned_amount: Mapped[int | None] = mapped_column(BigInteger)

    # An open correction or removal, the bank's values before a correction's change, and the
    # bank's values the user last declined with Keep current value, so the same proposal delivered
    # again doesn't reopen review until accepting a change or aligning a field replaces them. The
    # previous values map each CorrectableBankField the correction changes to the bank's value
    # before it, while the observation holds the proposal. A removal opened over a correction keeps
    # them, since that correction is still undecided. The declined values map every
    # CorrectableBankField. Dates are ISO text, and an amount the bank sent that couldn't be stored
    # exactly is the text it sent
    open_kind: Mapped[str | None] = mapped_column(VARCHAR(16))
    previous_values: Mapped[dict[str, Any] | None] = mapped_column(_JSON)
    declined_observation: Mapped[dict[str, Any] | None] = mapped_column(_JSON)

    # The bank description the user kept with Keep current value over a later one, while the bank's
    # latest differs from it. The ledger has no description column, so this stands in for the
    # ledger's own value, as the ledger row's date and amount do for theirs. Null while the ledger
    # follows the bank's description: its latest, or its value from before a correction waiting on it
    kept_description: Mapped[str | None] = mapped_column(Text)

    # When the provider reported the transaction removed from its feed, kept after the user keeps it
    # so the same removal delivered again opens nothing, and cleared once the provider sends the
    # transaction again
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Moves on every ORM update, so a bulk approval can skip an item that changed after its preview.
    # A Core update has to move it itself
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    __mapper_args__: ClassVar[dict[str, Any]] = {"version_id_col": version}
