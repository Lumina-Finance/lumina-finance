"""Cash-flow service for the insights page."""

import uuid
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.insights import InsightsCashFlowResponse
from app.services.insights.common import get_base_currency_accounts

CashFlowGranularity = Literal["day", "week", "month"]

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"


def _get_granularity(from_date: date, to_date: date) -> CashFlowGranularity:
    day_count = (to_date - from_date).days + 1
    if day_count <= 31:
        return "day"
    if day_count <= 90:
        return "week"
    return "month"


def _bucket_key(target: date, granularity: CashFlowGranularity) -> tuple[int, ...]:
    if granularity == "day":
        return (target.year, target.month, target.day)
    if granularity == "week":
        iso_year, iso_week, _weekday = target.isocalendar()
        return (iso_year, iso_week)
    return (target.year, target.month)


def _build_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    granularity = _get_granularity(from_date, to_date)
    buckets: list[tuple[date, date]] = []
    bucket_start = from_date
    current_key = _bucket_key(from_date, granularity)
    cursor = from_date

    while cursor <= to_date:
        key = _bucket_key(cursor, granularity)
        if key != current_key:
            buckets.append((bucket_start, cursor - timedelta(days=1)))
            bucket_start = cursor
            current_key = key
        cursor += timedelta(days=1)

    buckets.append((bucket_start, to_date))
    return buckets


async def _query_daily_cash_flow(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> dict[date, tuple[int, int]]:
    result = await db.execute(
        select(
            Transaction.dt,
            func.coalesce(
                func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)),
                0,
            ).label("inflow"),
            func.coalesce(
                func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0)),
                0,
            ).label("outflow"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
            or_(
                Category.kind.in_((CategoryKind.INCOME, CategoryKind.EXPENSE)),
                (
                    (Category.kind == CategoryKind.TRANSFER)
                    & (Category.name != _BALANCE_ADJUSTMENT_CATEGORY_NAME)
                ),
            ),
        )
        .group_by(Transaction.dt)
        .order_by(Transaction.dt),
    )

    return {
        row.dt: (int(row.inflow or 0), int(row.outflow or 0))
        for row in result
    }


def _bucket_points(
    buckets: list[tuple[date, date]],
    daily_totals: dict[date, tuple[int, int]],
) -> list[tuple[date, date, int, int]]:
    points: list[tuple[date, date, int, int]] = []
    for bucket_start, bucket_end in buckets:
        inflow = 0
        outflow = 0
        cursor = bucket_start
        while cursor <= bucket_end:
            day_inflow, day_outflow = daily_totals.get(cursor, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            cursor += timedelta(days=1)
        points.append((bucket_start, bucket_end, inflow, outflow))
    return points


async def get_cash_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsCashFlowResponse:
    """Return inflow and outflow buckets for the cash-flow card."""
    accounts = await get_base_currency_accounts(db, user)
    account_ids = [account.id for account in accounts]
    if not account_ids:
        return InsightsCashFlowResponse(points=[])

    buckets = _build_buckets(from_date, to_date)
    daily_totals = await _query_daily_cash_flow(db, account_ids, from_date, to_date)
    if not any(inflow > 0 or outflow > 0 for inflow, outflow in daily_totals.values()):
        return InsightsCashFlowResponse(points=[])

    return InsightsCashFlowResponse(points=_bucket_points(buckets, daily_totals))
