"""Account starting balance helpers"""

import uuid
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.group import GroupMember
from app.models.user import User
from app.permissions import check_account_access
from app.routes.accounts.creation_scope_helpers import get_group_owner_timezone_or_404
from app.routes.accounts.response_loading_helpers import get_account_for_response
from app.schemas.account import RecordStartingBalanceRequest
from app.services.accounts.access import own_personal_account_condition
from app.services.accounts.balance_adjustments import record_account_starting_balance
from app.services.cache_state import mark_cache_changed_for_scope
from app.utils.dates import ACCOUNT_OWNER_PROFILE, resolve_timezone

_NOT_OWN_ACCOUNT_DETAIL = "Starting balances can only be recorded on your own accounts"


async def record_starting_balance_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    data: RecordStartingBalanceRequest,
    user: User,
    now: datetime,
) -> Account:
    """Record a starting balance on the user's own personal account or a group account they administer

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        data: Starting balance as the user states it
        user: Authenticated user recording the starting balance
        now: The current time in the user's timezone, whose date sets the balance fields

    Returns:
        Account with derived balance fields

    Raises:
        HTTPException: The account isn't visible to the user, isn't one they own or administer, its
            owner's timezone isn't recognized, or it can't take a starting balance
    """
    account = await _get_account_taking_starting_balance(db, account_id, user.id)
    await record_account_starting_balance(
        db,
        account,
        user=user,
        amount=data.amount,
        adjustment_date=await _account_owners_today(db, account, now),
    )

    # Mark the account scope stale before returning the account with derived fields
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()

    return await get_account_for_response(db, user, account_id, now.date())


async def _get_account_taking_starting_balance(db: AsyncSession, account_id: uuid.UUID, user_id: uuid.UUID) -> Account:
    """Return the account when it is the user's own personal account or a group account they administer

    Only a group's admins can create its accounts, so they are the ones who state a new group
    account's starting balance. A permission grant, even an admin one, doesn't make an account the
    user's own

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: User recording the starting balance

    Returns:
        The account

    Raises:
        HTTPException: The account isn't visible to the user, or is visible but isn't one they own
            or administer
    """
    administered_groups = select(GroupMember.group_id).where(GroupMember.user_id == user_id, GroupMember.is_admin.is_(True))
    account = await db.scalar(
        select(Account).where(
            Account.id == account_id,
            own_personal_account_condition(user_id) | Account.group_id.in_(administered_groups),
        ),
    )
    if account is not None:
        return account

    # Not found for an account the user can't see, so only a visible one is refused as not their own
    await check_account_access(db, account_id, user_id, PermissionLevel.READ)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_NOT_OWN_ACCOUNT_DETAIL)


async def _account_owners_today(db: AsyncSession, account: Account, now: datetime) -> date:
    """Return today for the account's owner, which dates its starting balance

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
