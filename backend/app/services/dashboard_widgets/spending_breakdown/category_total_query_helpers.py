"""Spending breakdown category total query helpers"""
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction


@dataclass(frozen=True, slots=True)
class SpendingBreakdownCategoryDailyTotal:
    """Daily aggregate row for one account and category

    Attributes:
        transaction_date: Date represented by the aggregate row
        account_id: Account that owns the aggregated transactions
        category_id: Category represented by the aggregate row
        category_name: Display name for the category
        category_kind: Category classification used to split income and expense
        amount: Signed total amount in the account currency
    """

    transaction_date: date
    account_id: uuid.UUID
    category_id: uuid.UUID
    category_name: str
    category_kind: CategoryKind
    amount: int


async def query_spending_breakdown_category_daily_totals(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    start: date,
    end: date,
) -> list[SpendingBreakdownCategoryDailyTotal]:
    """Return grouped category totals for a spending breakdown

    The query keeps account, date, and category on each aggregate row so
    foreign-currency totals can be converted before categories are merged

    Args:
        db: Active database session
        account_ids: Account identifiers readable by the dashboard viewer
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Grouped transaction totals for income and expense categories
    """
    category_total_query = (
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id,
            Category.name,
            Category.kind,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id, Category.id, Category.name, Category.kind)
    )

    # Aggregate daily income and expense totals across readable dashboard accounts
    result = await db.execute(category_total_query)
    category_daily_totals = [
        SpendingBreakdownCategoryDailyTotal(
            transaction_date=row.dt,
            account_id=row.account_id,
            category_id=row.id,
            category_name=row.name,
            category_kind=row.kind,
            amount=int(row.total or 0),
        )
        for row in result
    ]
    return category_daily_totals
