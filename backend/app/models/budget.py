import uuid
from datetime import date, datetime

from sqlalchemy import (
    VARCHAR,
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    SmallInteger,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, PermissionLevel, RecurrenceFreq


class Budget(Base):
    """Spending plan for a time period. Recurring budgets use a template/instance pattern."""

    __tablename__ = "budgets"
    __table_args__ = (
        CheckConstraint(
            "(owner_id IS NOT NULL AND household_id IS NULL) OR (owner_id IS NULL AND household_id IS NOT NULL)",
            name="ck_budgets_owner_xor_household",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    household_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    # Null = standalone or base budget; non-null = recurring instance derived from the base
    base_budget_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("budgets.id"))
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    recurrence_freq: Mapped[RecurrenceFreq | None] = mapped_column()  # Null = one-off; only set on template
    recurrence_interval: Mapped[int | None] = mapped_column(SmallInteger)  # e.g., 1 = every period, 2 = every other
    overall_limit: Mapped[int | None] = mapped_column(BigInteger)  # Optional spending cap across all categories
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class BudgetTrackedCategory(Base):
    """Tracks which categories a budget monitors and when. Enables historical budget utilization."""

    __tablename__ = "budget_tracked_categories"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BudgetPermission(Base):
    """Per-budget permission for a household member. Admins have implicit full access."""

    __tablename__ = "budget_permissions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["household_id", "user_id"],
            ["household_members.household_id", "household_members.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("household_id", "user_id", "budget_id", name="uq_budget_perm_member_budget"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False)
    level: Mapped[PermissionLevel] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
