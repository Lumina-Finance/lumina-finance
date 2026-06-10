"""Spending comparison daily expense query helpers"""
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction


@dataclass(frozen=True, slots=True)
class SpendingComparisonDailyExpenseTotal:
    """Daily aggregate total for one account

    Attributes:
        transaction_date: Date represented by the aggregate total
        account_id: Account that owns the aggregated transactions
        amount: Signed total amount in the account currency
    """

    transaction_date: date
    account_id: uuid.UUID
    amount: int


async def query_spending_comparison_daily_expense_totals(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    start: date,
    end: date,
) -> list[SpendingComparisonDailyExpenseTotal]:
    """Return grouped daily expense totals for spending comparison

    The query groups account-currency expense totals by transaction date and
    account so conversion happens before same-date totals are merged

    Args:
        db: Active database session
        account_ids: Account identifiers readable by the dashboard viewer
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Daily expense totals grouped by transaction date and account
    """
    daily_expense_query = (
        select(
            Transaction.dt,
            Transaction.account_id,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id)
    )

    # Aggregate daily expense totals across readable accounts for one comparison window
    result = await db.execute(daily_expense_query)
    daily_expense_totals = [
        SpendingComparisonDailyExpenseTotal(
            transaction_date=row.dt,
            account_id=row.account_id,
            amount=int(row.total or 0),
        )
        for row in result
    ]
    return daily_expense_totals
