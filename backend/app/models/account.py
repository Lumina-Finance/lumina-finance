import uuid
from datetime import datetime

from sqlalchemy import (
    VARCHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    SmallInteger,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AccountKind, AccountType, Base, PermissionLevel, TaxTreatment
from app.models.institution import Institution


class Account(Base):
    """Represents a real-world financial account. Owned by either a user or a group, never both."""

    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(
            "(owner_id IS NOT NULL AND group_id IS NULL) OR (owner_id IS NULL AND group_id IS NOT NULL)",
            name="ck_accounts_owner_xor_group",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    account_kind: Mapped[AccountKind] = mapped_column(nullable=False)
    account_type: Mapped[AccountType] = mapped_column(nullable=False)
    tax_treatment: Mapped[TaxTreatment] = mapped_column(nullable=False, default=TaxTreatment.TAXABLE)
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    institution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("institutions.id"))
    institution: Mapped[Institution | None] = relationship(lazy="raise")
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    lifetime_contribution_limit: Mapped[int | None] = mapped_column(BigInteger)  # In currency base units; null if N/A
    credit_limit: Mapped[int | None] = mapped_column(BigInteger)  # Liability accounts only; null on assets and unset liabilities
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AccountPermission(Base):
    """Per-account permission for a group member. Admins have implicit full access."""

    __tablename__ = "account_permissions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["group_id", "user_id"],
            ["group_members.group_id", "group_members.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("group_id", "user_id", "account_id", name="uq_account_perm_member_account"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    level: Mapped[PermissionLevel] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AccountBalanceSnapshot(Base):
    """End-of-day balance record for historical balance charts and net worth tracking.

    Snapshots are derived from transactions: one row per (account, day) where a
    transaction occurred. The backend maintains these automatically on transaction
    mutations — never written to directly by users.

    Convention: `ts` is always stored as midnight UTC of the snapshot's day
    (e.g., 2026-03-15 00:00:00+00). Using timestamptz keeps the column type
    consistent with transactions while still enforcing daily granularity via the
    midnight convention enforced in the snapshot service.
    """

    __tablename__ = "account_balance_snapshots"

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    balance: Mapped[int] = mapped_column(BigInteger, nullable=False)  # In currency base units
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, nullable=False)


class TaxAdvantagedConfig(Base):
    """Per-account, per-year contribution and withdrawal limits. User is responsible for entering limits."""

    __tablename__ = "tax_advantaged_configs"

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), primary_key=True, nullable=False)
    year: Mapped[int] = mapped_column(SmallInteger, primary_key=True, nullable=False)
    contribution_limit: Mapped[int] = mapped_column(BigInteger, nullable=False)  # Annual limit in currency base units
    withdrawal_limit: Mapped[int | None] = mapped_column(BigInteger)  # Null = no limit
