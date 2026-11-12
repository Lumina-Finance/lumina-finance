"""Account starting balance service"""

import uuid
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.rls.functions import USER_TZ
from app.models.account import Account
from app.models.user import User
from app.schemas.account import RecordStartingBalanceRequest
from app.services.accounts.access import get_account_meeting, own_or_administered_account_condition
from app.services.accounts.balance_adjustments import record_account_starting_balance
from app.services.cache_state import mark_cache_changed_for_scope
from app.utils.dates import ACCOUNT_OWNER_PROFILE, resolve_timezone

_NOT_OWN_ACCOUNT_DETAIL = "Starting balances can only be recorded on your own accounts"


async def get_group_owner_timezone_or_404(db: AsyncSession, group_id: uuid.UUID) -> str:
    """Return the group owner's timezone or raise a not-found response

    Args:
        db: Active database session
        group_id: Group identifier from the request

    Returns:
        Group owner's timezone

    Raises:
        HTTPException: Group does not exist
    """
    # Fetch the owning user's timezone so group-account history starts on the owner's
    # local day, through the helper since the owner's user row is not directly visible
    group_owner_tz = await db.scalar(
        text(f"SELECT {USER_TZ}(owner_id) FROM public.groups WHERE id = :group_id"),  # noqa: S608
        {"group_id": group_id},
    )
    if group_owner_tz is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group_owner_tz


async def record_starting_balance_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    data: RecordStartingBalanceRequest,
    user: User,
    now: datetime,
) -> None:
    """Record a starting balance on the user's own personal account or a group account they administer

    A zero amount records nothing. The caller loads the account for its response afterwards

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        data: Starting balance as the user states it
        user: Authenticated user recording the starting balance
        now: The current time in the user's timezone. Its date sets the balance fields

    Raises:
        HTTPException: The account isn't visible to the user, isn't one they own or administer, its
            owner's timezone isn't recognized, or it can't take a starting balance
    """
    account = await get_account_meeting(
        db, account_id, user.id, own_or_administered_account_condition(user.id), refused_detail=_NOT_OWN_ACCOUNT_DETAIL
    )
    if not data.amount:
        return

    await record_account_starting_balance(
        db,
        account,
        user=user,
        amount=data.amount,
        adjustment_date=await _account_owners_today(db, account, now),
    )

    # Mark the account scope stale before the caller returns the account with derived fields
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()


async def _account_owners_today(db: AsyncSession, account: Account, now: datetime) -> date:
    """Return today for the account's owner, the date of its starting balance

    A group account's history starts on the group owner's day, as its creation snapshot does, so
    its starting balance lands on that day rather than the admin's who records it

    Args:
        db: Active database session
        account: Account receiving the starting balance
        now: The current time in the user's timezone

    Returns:
        The user's today for a personal account, or the group owner's for a group account

    Raises:
        HTTPException: The group owner's timezone isn't recognized
    """
    if account.group_id is None:
        return now.date()
    owner_tz = await get_group_owner_timezone_or_404(db, account.group_id)
    return now.astimezone(resolve_timezone(owner_tz, stored_on=ACCOUNT_OWNER_PROFILE)).date()
