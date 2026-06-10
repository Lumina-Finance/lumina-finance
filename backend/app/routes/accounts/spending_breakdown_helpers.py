"""Account spending breakdown helpers"""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_account_access
from app.schemas.account import AccountSpendingBreakdown
from app.schemas.dashboard import RangeKind
from app.services.accounts import get_account_spending_breakdown


async def get_account_spending_breakdown_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    range_: RangeKind,
    as_of_dt: datetime,
) -> AccountSpendingBreakdown:
    """Return an account spending breakdown after checking read access

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: Authenticated user identifier
        range_: Calendar period used for spending totals
        as_of_dt: Datetime used to anchor the requested range

    Returns:
        Spending breakdown for the account and range

    Raises:
        HTTPException: User does not have read access
    """
    await check_account_access(db, account_id, user_id, PermissionLevel.READ)
    breakdown = await get_account_spending_breakdown(db, account_id, range_, as_of_dt)
    return breakdown
