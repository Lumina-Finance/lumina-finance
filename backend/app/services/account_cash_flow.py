"""Account cash-flow analytics service"""
import uuid
from datetime import date, datetime

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.dashboard import MonthlyIncomeExpense

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"


async def get_account_cash_flow_history(
    db: AsyncSession,
    account_id: uuid.UUID,
    months: int,
    now: datetime,
) -> list[MonthlyIncomeExpense]:
    """Return monthly cash-in and cash-out totals for a single account

    Args:
        db: Active database session
        account_id: Account receiving the cash-flow history
        months: Number of months to include, ending in the current month
        now: Viewer-local timestamp used to derive the current month

    Returns:
        Oldest-first monthly income and expense totals
    """
    month_starts = _get_recent_month_start_dates(now, months)
    window_start = month_starts[0]
    window_end = _get_next_month_start_date(now)

    month_start_expr = func.date_trunc("month", Transaction.dt).label("month_start")
    # Aggregate eligible cash-flow transactions into monthly income and expense totals
    query_result = await db.execute(
        select(
            month_start_expr,
            func.coalesce(
                func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)),
                0,
            ).label("income"),
            func.coalesce(
                func.sum(case((Transaction.amount < 0, Transaction.amount), else_=0)),
                0,
            ).label("expenses"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id == account_id,
            Transaction.dt >= window_start,
            Transaction.dt < window_end,
            _build_cash_flow_category_predicate(),
        )
        .group_by(month_start_expr),
    )

    monthly_totals = _map_cash_flow_totals_by_month_start(query_result)
    return [
        MonthlyIncomeExpense(
            month=month_start,
            income=monthly_totals.get(month_start, (0, 0))[0],
            expenses=monthly_totals.get(month_start, (0, 0))[1],
        )
        for month_start in month_starts
    ]


def _get_next_month_start_date(now: datetime) -> date:
    """Return the first day of the month immediately after ``now``

    Args:
        now: Viewer-local timestamp used as the reference month

    Returns:
        First day of the next calendar month
    """
    if now.month == 12:
        return date(now.year + 1, 1, 1)
    return date(now.year, now.month + 1, 1)


def _get_recent_month_start_dates(now: datetime, months: int) -> list[date]:
    """Return recent month start dates ending with the reference month

    Args:
        now: Viewer-local timestamp used as the reference month
        months: Number of monthly entries to return

    Returns:
        Oldest-first first-of-month dates ending with ``now``'s month
    """
    year, month = now.year, now.month
    for _ in range(months - 1):
        if month == 1:
            year -= 1
            month = 12
        else:
            month -= 1

    month_starts: list[date] = []
    for _ in range(months):
        month_starts.append(date(year, month, 1))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return month_starts


def _build_cash_flow_category_predicate():
    """Build the predicate for categories that count as cash flow

    Returns:
        SQLAlchemy predicate for cash-flow category eligibility
    """
    return or_(
        Category.kind.in_((CategoryKind.INCOME, CategoryKind.EXPENSE)),
        (
            (Category.kind == CategoryKind.TRANSFER)
            & (Category.name != _BALANCE_ADJUSTMENT_CATEGORY_NAME)
        ),
    )


def _map_cash_flow_totals_by_month_start(rows) -> dict[date, tuple[int, int]]:
    """Return cash-flow totals keyed by month start

    Args:
        rows: Cash-flow aggregate rows from the database

    Returns:
        Mapping from month start date to income and expense totals
    """
    monthly_totals: dict[date, tuple[int, int]] = {}
    for row in rows:
        month_start = row.month_start.date() if hasattr(row.month_start, "date") else row.month_start
        monthly_totals[month_start] = (int(row.income), abs(int(row.expenses)))
    return monthly_totals
