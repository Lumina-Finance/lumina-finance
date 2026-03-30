import uuid
from datetime import date, datetime

from sqlalchemy import VARCHAR, BigInteger, CheckConstraint, Date, DateTime, ForeignKey, SmallInteger, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, RecurrenceFreq


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
    household_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("households.id"))
    parent_budget_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("budgets.id"))  # Null = template or one-off
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    recurrence_freq: Mapped[RecurrenceFreq | None] = mapped_column()  # Null = one-off; only set on template
    recurrence_interval: Mapped[int | None] = mapped_column(SmallInteger)  # e.g., 1 = every period, 2 = every other
    overall_limit: Mapped[int | None] = mapped_column(BigInteger)  # Optional spending cap across all categories
    currency: Mapped[str] = mapped_column(VARCHAR(3), ForeignKey("currencies.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class BudgetAllocation(Base):
    """A named spending limit within a budget. Can cover one or multiple categories."""

    __tablename__ = "budget_allocations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id"), nullable=False)
    name: Mapped[str] = mapped_column(VARCHAR(256), nullable=False)  # e.g., "Groceries" or "All Food"
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)  # Spend limit in budget's currency units


class BudgetAllocationCategory(Base):
    """Links a budget allocation to one or more categories."""

    __tablename__ = "budget_allocation_categories"

    allocation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budget_allocations.id"), primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"), primary_key=True)


class BudgetMember(Base):
    """Scopes a household budget to specific members. No rows = all members included."""

    __tablename__ = "budget_members"

    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
