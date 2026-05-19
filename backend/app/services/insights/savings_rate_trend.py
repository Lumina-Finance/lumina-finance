"""Savings-rate trend service for the insights page."""

import uuid
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.insights import InsightsSavingsRateTrendResponse
from app.services.insights.common import get_base_currency_accounts

SAVINGS_RATE_TREND_MONTHS = 12


def _month_start(target: date) -> date:
    return date(target.year, target.month, 1)


def _add_months(target: date, months: int) -> date:
    month_index = (target.year * 12) + (target.month - 1) + months
    return date(month_index // 12, (month_index % 12) + 1, 1)


def _build_months(start_month: date, end_month: date) -> list[date]:
    months: list[date] = []
    cursor = start_month
    while cursor <= end_month:
        months.append(cursor)
        cursor = _add_months(cursor, 1)
    return months


async def _first_activity_month(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_end: date,
) -> date | None:
    result = await db.execute(
        select(func.min(Transaction.dt))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt < window_end,
        ),
    )
    first_activity = result.scalar_one_or_none()
    return _month_start(first_activity) if first_activity else None


async def get_savings_rate_trend(
    db: AsyncSession,
    user: User,
    now: datetime,
) -> InsightsSavingsRateTrendResponse:
    """Return latest available monthly income and expense totals for savings-rate trend."""
    accounts = await get_base_currency_accounts(db, user)
    account_ids = [account.id for account in accounts]
    if not account_ids:
        return InsightsSavingsRateTrendResponse(points=[])

    current_month = _month_start(now.date())
    window_end = _add_months(current_month, 1)
    first_activity_month = await _first_activity_month(db, account_ids, window_end)
    if first_activity_month is None:
        return InsightsSavingsRateTrendResponse(points=[])

    earliest_visible_month = _add_months(current_month, -(SAVINGS_RATE_TREND_MONTHS - 1))
    start_month = max(first_activity_month, earliest_visible_month)
    months = _build_months(start_month, current_month)
    totals: dict[date, dict[CategoryKind, int]] = {month: {} for month in months}

    month_start_expr = func.date_trunc("month", Transaction.dt).label("month_start")
    result = await db.execute(
        select(month_start_expr, Category.kind, func.sum(Transaction.amount).label("total"))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= start_month,
            Transaction.dt < window_end,
        )
        .group_by(month_start_expr, Category.kind),
    )

    for row in result:
        month = row.month_start.date() if hasattr(row.month_start, "date") else row.month_start
        totals[month][row.kind] = int(row.total or 0)

    return InsightsSavingsRateTrendResponse(
        points=[
            (
                month,
                totals[month].get(CategoryKind.INCOME, 0),
                max(-totals[month].get(CategoryKind.EXPENSE, 0), 0),
            )
            for month in months
        ],
    )
