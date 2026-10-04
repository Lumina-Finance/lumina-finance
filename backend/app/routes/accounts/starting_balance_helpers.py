"""Account starting balance helpers"""
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_account_access
from app.routes.accounts.response_loading_helpers import get_account_for_response
from app.schemas.account import RecordStartingBalanceRequest
from app.services.accounts.balance_adjustments import record_account_starting_balance
from app.services.cache_state import mark_cache_changed_for_scope


async def record_starting_balance_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    data: RecordStartingBalanceRequest,
    user: User,
    today: date,
) -> Account:
    """Record an account's starting balance for a user

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        data: Starting balance as the user states it
        user: Authenticated user recording the starting balance
        today: The user's today, which dates the adjustment and the balance fields

    Returns:
        Account with derived balance fields

    Raises:
        HTTPException: User lacks admin access, or the account can't take a starting balance
    """
    account = await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)
    await record_account_starting_balance(
        db,
        account,
        user_id=user.id,
        amount=data.amount,
        adjustment_date=today,
    )

    # Mark the account scope stale before returning the account with derived fields
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()

    return await get_account_for_response(db, user, account_id, today)
