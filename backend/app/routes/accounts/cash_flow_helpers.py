"""Account cash flow helpers"""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_account_access
from app.schemas.dashboard import MonthlyIncomeExpense
from app.services.accounts import get_account_cash_flow_history


async def get_account_cash_flow_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    months: int,
    as_of_dt: datetime,
) -> list[MonthlyIncomeExpense]:
    """Return account cash flow history after checking read access

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: Authenticated user identifier
        months: Number of months to include, ending in the current month
        as_of_dt: Datetime used to anchor the cash flow history

    Returns:
        Oldest-first monthly income and expense totals

    Raises:
        HTTPException: User does not have read access
    """
    await check_account_access(db, account_id, user_id, PermissionLevel.READ)
    cash_flow = await get_account_cash_flow_history(db, account_id, months, as_of_dt)
    return cash_flow
