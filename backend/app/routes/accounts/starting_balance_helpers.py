"""Account starting balance helpers"""
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
from app.routes.accounts.response_loading_helpers import get_account_for_response
from app.schemas.account import RecordStartingBalanceRequest
from app.services.accounts.access import get_own_personal_account
from app.services.accounts.balance_adjustments import record_account_starting_balance
from app.services.cache_state import mark_cache_changed_for_scope

_NOT_OWN_ACCOUNT_DETAIL = "Starting balances can only be recorded on your own accounts"


async def record_starting_balance_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    data: RecordStartingBalanceRequest,
    user: User,
    today: date,
) -> Account:
    """Record a starting balance on one of the user's own personal accounts

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        data: Starting balance as the user states it
        user: Authenticated user recording the starting balance
        today: The user's today, which dates the starting balance and the balance fields

    Returns:
        Account with derived balance fields

    Raises:
        HTTPException: The account isn't visible to the user, isn't their own personal account, or
            can't take a starting balance
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=_NOT_OWN_ACCOUNT_DETAIL)
    await record_account_starting_balance(
        db,
        account,
        user_id=user.id,
        amount=data.amount,
        adjustment_date=today,
    )

    # Mark the account scope stale before returning the account with derived fields
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=None)
    await db.commit()

    return await get_account_for_response(db, user, account_id, today)
