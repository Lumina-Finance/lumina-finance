"""Dashboard aggregation endpoint

Thin orchestrator that composes per-widget service helpers into dashboard
response payloads. The heavy SQL, date math, and widget-specific computation
live in service modules, while this file wires the results together
"""
from datetime import datetime as DateTime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.dashboard.widget_helpers import (
    get_credit_widget_for_user,
    get_net_worth_widget_for_user,
    get_recent_activity_widget_for_user,
    get_savings_rate_widget_for_user,
    get_spending_breakdown_for_user,
    get_spending_comparison_for_user,
)
from app.schemas.dashboard import (
    CreditUtilizationResponse,
    CreditWidgetResponse,
    NetWorthWidgetResponse,
    RangeKind,
    RecentActivityWidgetResponse,
    ReplaceCreditExcludedAccountsRequest,
    SavingsRateWidgetResponse,
    SpendingBreakdownResponse,
    SpendingComparisonResponse,
)
from app.services.dashboard_widgets.credit_utilization import (
    get_credit_utilization,
    replace_credit_utilization_exclusions,
)
from app.utils.dates import resolve_timezone

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _get_viewer_local_now(user: User) -> DateTime:
    """Return the viewer-local datetime used by dashboard routes

    Args:
        user: Authenticated user whose timezone anchors dashboard windows

    Returns:
        Viewer-local datetime for the user's timezone

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    from app.routes import dashboard as dashboard_routes

    now = dashboard_routes.datetime.now(resolve_timezone(user.tz))
    return now


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

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
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

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
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

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
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

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
    response = await get_credit_widget_for_user(db, user, now)
    return response


@router.get("/credit-utilization", response_model=CreditUtilizationResponse)
async def get_credit_utilization_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the credit totals the dashboard credit widget shows

    Unlike `/credit`, which totals every readable credit account, this leaves out the
    accounts the user chose not to count, and lists the accounts they can choose between

    Args:
        user: Authenticated user requesting credit utilization
        db: Active database session

    Returns:
        Credit utilization response

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
    response = await get_credit_utilization(db, user, now.date())
    return response


@router.put("/credit-utilization/excluded-accounts", response_model=CreditUtilizationResponse)
async def replace_credit_excluded_accounts_route(
    data: ReplaceCreditExcludedAccountsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the credit accounts the user leaves out of the dashboard credit widget

    Rejects the whole request with 404 when an account isn't readable by the user, and
    with 422 when it isn't a credit account with a limit. Choices stored for accounts
    the user can't read are kept

    Args:
        data: Credit accounts to leave out
        user: Authenticated user changing the choice
        db: Active database session

    Returns:
        Credit utilization response reflecting the new choice

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
    response = await replace_credit_utilization_exclusions(db, user, data.account_ids, now.date())
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

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
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

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    now = _get_viewer_local_now(user)
    response = await get_spending_breakdown_for_user(db, user, range_, now)
    return response
