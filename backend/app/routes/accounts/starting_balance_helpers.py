"""Account starting balance helpers"""
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User
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
        HTTPException: The account isn't the user's own personal account, or can't take a starting balance
    """
    account = await _get_own_personal_account_or_404(db, account_id, user.id)
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


async def _get_own_personal_account_or_404(db: AsyncSession, account_id: uuid.UUID, user_id: uuid.UUID) -> Account:
    """Return the user's own personal account, the only kind a starting balance is recorded on

    Grouped resources are left out of new flows until they are built, so a group account is not
    found here even by its group's admin or a member it was shared with through a permission grant,
    just as an account that is missing or belongs to someone else is not

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: User recording the starting balance

    Returns:
        The account

    Raises:
        HTTPException: The account isn't the user's own personal account
    """
    account = await db.scalar(
        select(Account).where(Account.id == account_id, Account.owner_id == user_id, Account.group_id.is_(None)),
    )
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account
