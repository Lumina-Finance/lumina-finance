"""Dashboard aggregation endpoint

Thin orchestrator that composes per-widget service helpers into dashboard
response payloads. The heavy SQL, date math, and widget-specific computation
live in service modules, while this file wires the results together
"""
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.dashboard_widget_helpers import (
    get_credit_widget_for_user,
    get_net_worth_widget_for_user,
    get_recent_activity_widget_for_user,
    get_savings_rate_widget_for_user,
    get_spending_comparison_for_user,
)
from app.schemas.dashboard import (
    CreditWidgetResponse,
    NetWorthWidgetResponse,
    RangeKind,
    RecentActivityWidgetResponse,
    SavingsRateWidgetResponse,
    SpendingBreakdownResponse,
    SpendingComparisonResponse,
)
from app.services.dashboard import get_accessible_accounts
from app.services.dashboard_widgets.spending_breakdown import get_spending_breakdown

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/recent-activity", response_model=RecentActivityWidgetResponse)
async def get_recent_activity_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    window_days: Annotated[int, Query(ge=1, le=365)] = 90,
):
    """Return recent transaction rows for the dashboard

    The route derives the viewer-local time window, loads readable accounts,
    and delegates transaction selection and response assembly to the widget
    service

    Args:
        user: Authenticated user requesting dashboard activity
        db: Active database session
        window_days: Number of days to include before the viewer-local date

    Returns:
        Recent activity widget response
    """
    now = datetime.now(ZoneInfo(user.tz))
    response = await get_recent_activity_widget_for_user(db, user, window_days, now)
    return response


@router.get("/savings-rate", response_model=SavingsRateWidgetResponse)
async def get_savings_rate_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return savings-rate history for the dashboard

    The route scopes the widget to accounts readable by the user and asks the
    service to produce monthly income and expense totals in the user's base
    currency

    Args:
        user: Authenticated user requesting savings-rate history
        db: Active database session

    Returns:
        Savings-rate widget response
    """
    now = datetime.now(ZoneInfo(user.tz))
    response = await get_savings_rate_widget_for_user(db, user, now)
    return response


@router.get("/net-worth", response_model=NetWorthWidgetResponse)
async def get_net_worth_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    window_days: Annotated[int, Query(ge=1, le=365)] = 90,
):
    """Return current net worth and daily history for the dashboard

    The route scopes the widget to readable accounts, derives the viewer-local
    date window, and delegates historical balance conversion to the widget
    service

    Args:
        user: Authenticated user requesting net-worth data
        db: Active database session
        window_days: Number of daily history slots to return

    Returns:
        Net-worth widget response
    """
    now = datetime.now(ZoneInfo(user.tz))
    response = await get_net_worth_widget_for_user(db, user, window_days, now)
    return response


@router.get("/credit", response_model=CreditWidgetResponse)
async def get_credit_widget_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return credit limit and usage totals for the dashboard

    The route loads readable accounts and lets the widget service filter
    revolving accounts, convert limits and balances, and report FX status

    Args:
        user: Authenticated user requesting credit totals
        db: Active database session

    Returns:
        Credit widget response
    """
    now = datetime.now(ZoneInfo(user.tz))
    response = await get_credit_widget_for_user(db, user, now)
    return response


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

    Args:
        user: Authenticated user requesting spending comparison data
        db: Active database session
        range_: Calendar range used for current and previous comparison slots

    Returns:
        Spending comparison widget response
    """
    now = datetime.now(ZoneInfo(user.tz))
    response = await get_spending_comparison_for_user(db, user, range_, now)
    return response


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

    Args:
        user: Authenticated user requesting spending breakdown data
        db: Active database session
        range_: Calendar range used for current-period breakdown totals

    Returns:
        Spending breakdown widget response
    """
    now = datetime.now(ZoneInfo(user.tz))
    accounts = await get_accessible_accounts(db, user)
    return await get_spending_breakdown(db, accounts, user.base_currency, range_, now)
