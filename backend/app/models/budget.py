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


class BaseBudget(Base):
    """Long-lived spending plan. Holds name, currency, recurrence, tracked categories, and permissions.

    Per-period caps and date ranges live on the child Budget instances so historical
    periods stay frozen when the base is edited. A non-recurring (one-off) budget is a
    BaseBudget with recurrence_freq = NULL and a single Budget instance.
    """

    __tablename__ = "base_budgets"
    __table_args__ = (
        CheckConstraint(
            "(owner_id IS NOT NULL AND group_id IS NULL) OR (owner_id IS NULL AND group_id IS NOT NULL)",
            name="ck_base_budgets_owner_xor_group",
        ),
        CheckConstraint(
            "recurrence_interval IS NULL OR recurrence_interval > 0",
            name="ck_base_budgets_recurrence_interval_positive",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    recurrence_freq: Mapped[RecurrenceFreq | None] = mapped_column()  # Null = one-off
    recurrence_interval: Mapped[int | None] = mapped_column(SmallInteger)  # e.g., 1 = every period, 2 = every other
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Budget(Base):
    """Per-period instance of a BaseBudget.

    Frozen after creation — editing fields on a past instance does not retroactively affect historical
    utilization because utilization reads the BaseBudget's category set as of this instance's period_end.
    """

    __tablename__ = "budgets"
    __table_args__ = (
        CheckConstraint(
            "overall_limit > 0",
            name="ck_budgets_overall_limit_positive",
        ),
        CheckConstraint(
            "period_end >= period_start",
            name="ck_budgets_period_end_after_start",
        ),
        UniqueConstraint("base_budget_id", "period_start", "period_end", name="uq_budget_base_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    base_budget_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("base_budgets.id", ondelete="CASCADE"), nullable=False,
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    overall_limit: Mapped[int] = mapped_column(BigInteger, nullable=False)  # Required positive cap
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
    """Per-budget permission for a group member. Admins have implicit full access."""

    __tablename__ = "budget_permissions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["group_id", "user_id"],
            ["group_members.group_id", "group_members.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("group_id", "user_id", "budget_id", name="uq_budget_perm_member_budget"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False)
    level: Mapped[PermissionLevel] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
