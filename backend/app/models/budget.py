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
    Index,
    SmallInteger,
    UniqueConstraint,
    func,
    text,
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
            "instance_length > 0",
            name="ck_base_budgets_instance_length_positive",
        ),
        CheckConstraint(
            "recurrence_weekday IS NULL OR (recurrence_weekday >= 0 AND recurrence_weekday <= 6)",
            name="ck_base_budgets_weekday_range",
        ),
        CheckConstraint(
            "recurrence_dom IS NULL OR (recurrence_dom >= 1 AND recurrence_dom <= 31)",
            name="ck_base_budgets_dom_range",
        ),
        CheckConstraint(
            "recurrence_month IS NULL OR (recurrence_month >= 1 AND recurrence_month <= 12)",
            name="ck_base_budgets_month_range",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    recurrence_freq: Mapped[RecurrenceFreq] = mapped_column(nullable=False)
    # Number of recurrence units each Budget instance spans.
    instance_length: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    recurrence_weekday: Mapped[int | None] = mapped_column(SmallInteger)  # 0=Mon..6=Sun, required iff freq=weekly
    recurrence_dom: Mapped[int | None] = mapped_column(SmallInteger)  # 1..31, required iff freq in (monthly, yearly)
    recurrence_month: Mapped[int | None] = mapped_column(SmallInteger)  # 1..12, required iff freq=yearly
    recurs: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # True = frontend auto-suggests next instance
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
    """Tracks which categories a base budget monitors and when.

    The added_at/removed_at pair lets the utilization query reconstruct the tracked set as of any
    period_end, so mutating the base does not rewrite historical period totals.
    """

    __tablename__ = "budget_tracked_categories"
    __table_args__ = (
        # At most one active row per (base_budget, category); multiple historical rows allowed so
        # re-adds after removal keep a clean audit trail.
        Index(
            "uq_budget_tracked_category_active", "base_budget_id", "category_id",
            unique=True, postgresql_where=text("removed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    base_budget_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("base_budgets.id", ondelete="CASCADE"), nullable=False,
    )
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"), nullable=False)
    added_at: Mapped[date] = mapped_column(Date, nullable=False)
    removed_at: Mapped[date | None] = mapped_column(Date)


class BudgetPermission(Base):
    """Per-base-budget permission for a group member. Admins have implicit full access."""

    __tablename__ = "budget_permissions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["group_id", "user_id"],
            ["group_members.group_id", "group_members.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("group_id", "user_id", "base_budget_id", name="uq_budget_perm_member_base_budget"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    base_budget_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("base_budgets.id", ondelete="CASCADE"), nullable=False,
    )
    level: Mapped[PermissionLevel] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
