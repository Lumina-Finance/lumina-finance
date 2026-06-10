"""Dashboard widget route helpers"""

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

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
from app.services.accounts.access import get_accessible_accounts
from app.services.dashboard_widgets.credit import get_credit_widget
from app.services.dashboard_widgets.net_worth import get_net_worth_history
from app.services.dashboard_widgets.recent_activity import get_recent_transactions
from app.services.dashboard_widgets.savings_rate import get_savings_rate_history
from app.services.dashboard_widgets.spending_breakdown import get_spending_breakdown
from app.services.dashboard_widgets.spending_comparison import get_spending_comparison


async def get_recent_activity_widget_for_user(
    db: AsyncSession,
    user: User,
    window_days: int,
    now: datetime,
) -> RecentActivityWidgetResponse:
    """Return recent activity dashboard data for a user

    Args:
        db: Active database session
        user: Authenticated user requesting dashboard activity
        window_days: Number of days to include before the viewer-local date
        now: Viewer-local datetime used to anchor the activity window

    Returns:
        Recent activity widget response
    """
    accounts = await get_accessible_accounts(db, user)
    account_ids = [account.id for account in accounts]
    recent_transactions = await get_recent_transactions(db, account_ids, window_days, now)
    response = RecentActivityWidgetResponse(
        recent_transactions=recent_transactions,
        transaction_window_days=window_days,
    )
    return response


async def get_savings_rate_widget_for_user(
    db: AsyncSession,
    user: User,
    now: datetime,
) -> SavingsRateWidgetResponse:
    """Return savings-rate dashboard data for a user

    Args:
        db: Active database session
        user: Authenticated user requesting savings-rate history
        now: Viewer-local datetime used to anchor monthly history

    Returns:
        Savings-rate widget response
    """
    accounts = await get_accessible_accounts(db, user)
    savings_rate_history, fx_status = await get_savings_rate_history(
        db,
        accounts,
        user.base_currency,
        now,
    )
    response = SavingsRateWidgetResponse(
        savings_rate_history=savings_rate_history,
        fx_status=fx_status,
    )
    return response


async def get_net_worth_widget_for_user(
    db: AsyncSession,
    user: User,
    window_days: int,
    now: datetime,
) -> NetWorthWidgetResponse:
    """Return net-worth dashboard data for a user

    Args:
        db: Active database session
        user: Authenticated user requesting net-worth data
        window_days: Number of daily history slots to return
        now: Viewer-local datetime used to anchor daily history

    Returns:
        Net-worth widget response
    """
    accounts = await get_accessible_accounts(db, user)
    current_net_worth, net_worth_history, fx_status = await get_net_worth_history(
        db,
        accounts,
        user.base_currency,
        window_days,
        now,
    )
    response = NetWorthWidgetResponse(
        current_net_worth=current_net_worth,
        net_worth_history=net_worth_history,
        net_worth_window_days=window_days,
        fx_status=fx_status,
    )
    return response


async def get_credit_widget_for_user(
    db: AsyncSession,
    user: User,
    now: datetime,
) -> CreditWidgetResponse:
    """Return credit dashboard data for a user

    Args:
        db: Active database session
        user: Authenticated user requesting credit totals
        now: Viewer-local datetime used to anchor balance conversion

    Returns:
        Credit widget response
    """
    accounts = await get_accessible_accounts(db, user)
    credit_limit_total, credit_used, fx_status = await get_credit_widget(
        db,
        accounts,
        user.base_currency,
        now.date(),
    )
    response = CreditWidgetResponse(
        credit_limit_total=credit_limit_total,
        credit_used=credit_used,
        fx_status=fx_status,
    )
    return response


async def get_spending_comparison_for_user(
    db: AsyncSession,
    user: User,
    range_: RangeKind,
    now: datetime,
) -> SpendingComparisonResponse:
    """Return spending comparison dashboard data for a user

    Args:
        db: Active database session
        user: Authenticated user requesting spending comparison data
        range_: Calendar range used for current and previous comparison slots
        now: Viewer-local datetime used to anchor the current period

    Returns:
        Spending comparison widget response
    """
    accounts = await get_accessible_accounts(db, user)
    response = await get_spending_comparison(db, accounts, user.base_currency, range_, now)
    return response


async def get_spending_breakdown_for_user(
    db: AsyncSession,
    user: User,
    range_: RangeKind,
    now: datetime,
) -> SpendingBreakdownResponse:
    """Return spending breakdown dashboard data for a user

    Args:
        db: Active database session
        user: Authenticated user requesting spending breakdown data
        range_: Calendar range used for current-period breakdown totals
        now: Viewer-local datetime used to anchor the current period

    Returns:
        Spending breakdown widget response
    """
    accounts = await get_accessible_accounts(db, user)
    response = await get_spending_breakdown(db, accounts, user.base_currency, range_, now)
    return response
