"""Account starting balance response helpers"""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.routes.accounts.response_loading_helpers import get_account_for_response
from app.schemas.account import RecordStartingBalanceRequest
from app.services.accounts.starting_balance import record_starting_balance_for_user
from app.utils.dates import resolve_timezone


async def record_starting_balance_response(
    db: AsyncSession,
    account_id: uuid.UUID,
    data: RecordStartingBalanceRequest,
    user: User,
) -> Account:
    """Record an account's starting balance and return the account with its derived fields

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        data: Starting balance as the user states it
        user: Authenticated user recording the starting balance

    Returns:
        Account with derived balance fields

    Raises:
        HTTPException: The account isn't visible to the user, isn't their own personal account or a
            group account they administer, or can't take a starting balance, or a stored timezone does
            not resolve
    """
    now = datetime.now(resolve_timezone(user.tz))
    await record_starting_balance_for_user(db, account_id, data, user, now)
    return await get_account_for_response(db, user, account_id, now.date())
