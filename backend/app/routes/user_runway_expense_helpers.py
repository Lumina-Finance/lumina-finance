"""User runway expense route helpers"""
import calendar
import uuid
from datetime import date
from typing import Any

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction

# Trailing window used to smooth seasonal spikes while staying current with lifestyle changes
_RUNWAY_WINDOW_MONTHS = 12


def get_runway_history_window(today: date) -> tuple[date, date]:
    """Return the completed-month history window for runway

    Args:
        today: Current date in the user's timezone

    Returns:
        Inclusive start date and exclusive end date for completed-month history
    """
    window_end = date(today.year, today.month, 1)
    window_start = _get_month_shifted_date(window_end, -_RUNWAY_WINDOW_MONTHS)
    history_window = (window_start, window_end)
    return history_window


async def get_runway_expense_rows(
    db: AsyncSession,
    readable_account_ids: set[uuid.UUID],
    window_start: date,
    window_end: date,
) -> list[Any]:
    """Return grouped expense rows inside the runway history window

    Args:
        db: Active database session
        readable_account_ids: Account IDs readable by the user
        window_start: Inclusive start date for completed-month history
        window_end: Exclusive end date for completed-month history

    Returns:
        Expense total rows grouped by date, account, and category
    """
    account_ids = readable_account_ids

    # Fetch expense totals by transaction date, account, and category inside the completed-month runway window
    expense_result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id.label("category_id"),
            sa.func.sum(Transaction.amount).label("total"),
        )
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(Transaction.account_id.in_(account_ids))
        .where(Transaction.dt >= window_start)
        .where(Transaction.dt < window_end)
        .where(Category.kind == CategoryKind.EXPENSE)
        .group_by(Transaction.dt, Transaction.account_id, Category.id)
    )
    expense_rows = list(expense_result)
    return expense_rows


def get_runway_expense_outflow_summary(
    category_month_totals: dict[tuple[date, uuid.UUID], int],
) -> tuple[int, int]:
    """Return covered month count and expense outflow for runway history

    Args:
        category_month_totals: Converted expense totals keyed by month and category

    Returns:
        Covered month count and net expense outflow
    """
    outflow_totals = [
        (month, total)
        for (month, _category_id), total in category_month_totals.items()
        if total < 0
    ]
    months_covered = len({month for month, _total in outflow_totals})

    # Negative expense category-month totals count toward runway while refunds reduce expenses
    expense_outflow = sum(total for _month, total in outflow_totals)
    summary = (months_covered, expense_outflow)
    return summary


def _get_month_shifted_date(start: date, months: int) -> date:
    """Return a date shifted by whole calendar months

    Args:
        start: Starting date
        months: Number of months to shift

    Returns:
        Shifted date anchored to the closest valid day in the target month
    """
    month_index = (start.year * 12 + start.month - 1) + months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    shifted_date = date(year, month, day)
    return shifted_date
