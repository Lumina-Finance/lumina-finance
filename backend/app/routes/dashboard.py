"""Dashboard aggregation endpoint

Thin orchestrator that composes the per-widget service helpers in
``app/services/dashboard.py`` into dashboard response payloads. The heavy SQL,
date math, and widget-specific computation live in the service module — this
file just wires the results together
"""
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.dashboard import (
    CreditWidgetResponse,
    NetWorthWidgetResponse,
    RangeKind,
    RecentActivityWidgetResponse,
    SavingsRateWidgetResponse,
    SpendingBreakdownResponse,
    SpendingComparisonResponse,
)
from app.services.dashboard import (
    get_accessible_accounts,
    get_credit_widget,
    get_net_worth_history,
    get_savings_rate_history,
    get_spending_breakdown,
    get_spending_comparison,
)
from app.services.dashboard_widgets.recent_activity import get_recent_transactions

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/recent-activity", response_model=RecentActivityWidgetResponse)
async def get_recent_activity_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    window_days: Annotated[int, Query(ge=1, le=365)] = 90,
):
    """Return recent transaction rows for the dashboard recent activity widget"""
    now = datetime.now(ZoneInfo(user.tz))
    accounts = await get_accessible_accounts(db, user)
    all_account_ids = [a.id for a in accounts]
    recent_transactions = await get_recent_transactions(db, all_account_ids, window_days, now)
    return RecentActivityWidgetResponse(
        recent_transactions=recent_transactions,
        transaction_window_days=window_days,
    )


@router.get("/savings-rate", response_model=SavingsRateWidgetResponse)
async def get_savings_rate_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return savings-rate history for the dashboard savings-rate widget"""
    now = datetime.now(ZoneInfo(user.tz))
    accounts = await get_accessible_accounts(db, user)
    savings_rate_history, fx_status = await get_savings_rate_history(
        db,
        accounts,
        user.base_currency,
        now,
    )
    return SavingsRateWidgetResponse(
        savings_rate_history=savings_rate_history,
        fx_status=fx_status,
    )


@router.get("/net-worth", response_model=NetWorthWidgetResponse)
async def get_net_worth_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    window_days: Annotated[int, Query(ge=1, le=365)] = 90,
):
    """Return net worth totals and trend for the dashboard net worth widget"""
    now = datetime.now(ZoneInfo(user.tz))
    accounts = await get_accessible_accounts(db, user)
    current_net_worth, net_worth_history, fx_status = await get_net_worth_history(
        db,
        accounts,
        user.base_currency,
        window_days,
        now,
    )
    return NetWorthWidgetResponse(
        current_net_worth=current_net_worth,
        net_worth_history=net_worth_history,
        net_worth_window_days=window_days,
        fx_status=fx_status,
    )


@router.get("/credit", response_model=CreditWidgetResponse)
async def get_credit_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return credit usage totals for the dashboard credit widget"""
    now = datetime.now(ZoneInfo(user.tz))
    accounts = await get_accessible_accounts(db, user)
    credit_limit_total, credit_used, fx_status = await get_credit_widget(
        db,
        accounts,
        user.base_currency,
        now.date(),
    )
    return CreditWidgetResponse(
        credit_limit_total=credit_limit_total,
        credit_used=credit_used,
        fx_status=fx_status,
    )


@router.get("/spending-comparison", response_model=SpendingComparisonResponse)
async def get_spending_comparison_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    range_: Annotated[RangeKind, Query(alias="range")] = "MTD",
):
    """Return current-vs-prior cumulative expense series for the spending widget

    ``range`` picks the calendar period: week-, month-, quarter-, or
    year-to-date. The payload is always same-length ``current`` / ``previous``
    cumulative totals in positive minor units, converted to the user's base
    currency when needed and scoped to expense categories
    """
    now = datetime.now(ZoneInfo(user.tz))
    accounts = await get_accessible_accounts(db, user)
    return await get_spending_comparison(db, accounts, user.base_currency, range_, now)


@router.get("/spending-breakdown", response_model=SpendingBreakdownResponse)
async def get_spending_breakdown_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    range_: Annotated[RangeKind, Query(alias="range")] = "MTD",
):
    """Return category-level expense and income totals for the breakdown widget

    Both breakdowns are returned in one payload so the spending/income toggle
    can flip without refetching. Foreign-currency account activity is converted
    to the user's base currency and uses the same current-period bounds as the
    spending comparison chart
    """
    now = datetime.now(ZoneInfo(user.tz))
    accounts = await get_accessible_accounts(db, user)
    return await get_spending_breakdown(db, accounts, user.base_currency, range_, now)
