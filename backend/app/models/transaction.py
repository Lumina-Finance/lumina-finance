"""Transaction model"""

import uuid
from datetime import date, datetime

from sqlalchemy import VARCHAR, BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TransferCounterpartyScope

# Characters a bank's transaction ID or bank account key may carry. OFX caps its transaction IDs
# at 255, and the import rows take both at this length so a longer one is refused as it is staged
MAX_BANK_TRANSACTION_ID_LENGTH = 255


class Transaction(Base):
    """Core ledger: positive amount = inflow, negative = outflow. Transfers are two independent rows."""

    __tablename__ = "transactions"
    __table_args__ = (
        # Null-safe on both sides, so an account recorded without a scope is rejected rather
        # than passing on an unknown comparison
        CheckConstraint(
            "(counterparty_account_id IS NOT NULL) = (counterparty_account_scope IS NOT DISTINCT FROM 'TRACKED')",
            name="ck_transactions_counterparty_account_scope_matches_id",
        ),
        # Serves the merchant listing, which sums a per-transaction weight over a bounded date
        # range for each merchant. Leading on merchant_id means it also covers every lookup that
        # filters on the merchant alone, so no separate index on that column is needed
        Index("ix_transactions_merchant_id_dt", "merchant_id", "dt"),

        # Supports account and date lookups for history, analytics and snapshot rebuilds
        Index("ix_transactions_account_id_dt", "account_id", "dt"),

        # A bank's transaction ID names one transaction only within the bank account it was issued
        # under, so the two are stored together or not at all
        CheckConstraint(
            "(bank_account_key IS NULL) = (bank_transaction_id IS NULL)",
            name="ck_transactions_bank_account_key_matches_bank_transaction_id",
        ),

        # Holds each bank transaction once in an account, so two imports of overlapping statements
        # saving into it at once cannot both write it. The import leaves out what an account already
        # holds before writing, so only such a race reaches this
        Index(
            "uq_transactions_account_bank_transaction", "account_id", "bank_account_key", "bank_transaction_id",
            unique=True, postgresql_where=text("bank_transaction_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)  # Audit trail
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    dt: Mapped[date] = mapped_column(Date, nullable=False)
    # The create and edit routes require one, so this is null only on a transaction recorded before
    # that rule or brought in by an import whose file named no merchant
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("merchants.id"))
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # In currency base units
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    fx_rate: Mapped[float | None] = mapped_column(Numeric)  # Exchange rate to account currency
    notes: Mapped[str | None] = mapped_column(Text)

    # The counterparty account of a transfer. Recording it creates no transaction there and
    # moves no balance, so deleting that account has to be refused rather than cascade here.
    #
    # Deferred to the commit rather than checked per row, because deleting a group cascades into
    # its accounts and their transactions in one statement, and an immediate check fires or not
    # depending on which physical row the cascade reaches first. RESTRICT cannot be deferred at
    # all, so the refusal comes from NO ACTION at the end of the transaction, by which point a
    # cascade that removed both sides together leaves nothing to complain about
    counterparty_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="NO ACTION", deferrable=True, initially="DEFERRED"),
        index=True,
    )
    counterparty_account_scope: Mapped[TransferCounterpartyScope | None] = mapped_column()

    # The import run that wrote this transaction, which is what undoing the import deletes by. Empty
    # on a transaction entered by hand or imported before runs recorded their transactions
    import_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("import_runs.id", ondelete="SET NULL"),
        index=True,
    )

    # The bank's own ID for the transaction and the bank account the statement names, as an OFX
    # import read them, so a later import into this account leaves the transaction out. Empty on a
    # transaction entered by hand, imported from a file with no such ID, or saved before IDs were
    # kept. No edit changes them, so an edited or moved transaction is still recognised
    bank_account_key: Mapped[str | None] = mapped_column(VARCHAR(MAX_BANK_TRANSACTION_ID_LENGTH))
    bank_transaction_id: Mapped[str | None] = mapped_column(VARCHAR(MAX_BANK_TRANSACTION_ID_LENGTH))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
