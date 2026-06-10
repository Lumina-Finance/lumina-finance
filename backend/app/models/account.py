"""Account and tax-advantaged plan models"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    VARCHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
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
    tax_advantaged_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tax_advantaged_plans.id", ondelete="SET NULL"),
    )
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    institution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("institutions.id"))
    institution: Mapped[Institution | None] = relationship(lazy="raise")
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    credit_limit: Mapped[int | None] = mapped_column(BigInteger)  # Liability accounts only; null on assets and unset liabilities
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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

    Snapshots include a zero-balance anchor plus one row per (account, day) where
    a transaction occurred. The backend maintains these automatically on
    transaction mutations — never written to directly by users.
    """

    __tablename__ = "account_balance_snapshots"

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    balance: Mapped[int] = mapped_column(BigInteger, nullable=False)  # In currency base units
    dt: Mapped[date] = mapped_column(Date, primary_key=True, nullable=False)


class TaxAdvantagedPlan(Base):
    """Individual-owned tax-advantaged limit tracker."""

    __tablename__ = "tax_advantaged_plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    plan_owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    tax_treatment: Mapped[TaxTreatment] = mapped_column(nullable=False)
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    lifetime_contribution_limit: Mapped[int | None] = mapped_column(BigInteger)
    accrued_contributions: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TaxAdvantagedPlanLimit(Base):
    """Per-plan, per-year contribution and withdrawal limits."""

    __tablename__ = "tax_advantaged_plan_limits"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tax_advantaged_plans.id", ondelete="CASCADE"), primary_key=True, nullable=False
    )
    year: Mapped[int] = mapped_column(SmallInteger, primary_key=True, nullable=False)
    contribution_limit: Mapped[int] = mapped_column(BigInteger, nullable=False)  # Annual limit in currency base units
    withdrawal_limit: Mapped[int | None] = mapped_column(BigInteger)  # Null = no limit
    accrued_contributions: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
    )
    accrued_withdrawals: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
    )
