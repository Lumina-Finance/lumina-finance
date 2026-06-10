"""Account listing helpers"""
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account, AccountPermission
from app.models.group import GroupMember
from app.models.user import User
from app.routes.accounts.balance_field_helpers import attach_account_balance_fields


async def get_account_overviews_for_user(
    db: AsyncSession,
    user: User,
    as_of_date: date,
) -> list[Account]:
    """Return account overviews visible to a user

    Args:
        db: Active database session
        user: Authenticated user requesting accounts
        as_of_date: Date used for current balance fields

    Returns:
        Accounts visible to the user with derived balance fields attached
    """
    accounts = await get_accounts_visible_to_user(db, user.id)

    # Attach balance fields after access filtering so each account has overview totals
    await attach_account_balance_fields(db, accounts, user, as_of_date)
    return accounts


async def get_accounts_visible_to_user(db: AsyncSession, user_id: uuid.UUID) -> list[Account]:
    """Return accounts visible to a user

    Args:
        db: Active database session
        user_id: Authenticated user identifier

    Returns:
        Accounts visible through ownership, group admin membership, or explicit permission
    """
    account_permission_match = (AccountPermission.account_id == Account.id) & (AccountPermission.user_id == user_id)
    account_visibility_filter = (
        (Account.owner_id == user_id)
        | ((GroupMember.user_id == user_id) & (GroupMember.is_admin.is_(True)))
        | (AccountPermission.user_id == user_id)
    )

    # Fetch accounts visible through ownership, group admin access, or explicit account permissions
    query = (
        select(Account)
        .options(selectinload(Account.institution))
        .outerjoin(GroupMember, Account.group_id == GroupMember.group_id)
        .outerjoin(AccountPermission, account_permission_match)
        .where(account_visibility_filter)
        .order_by(Account.created_at)
    )

    # Execute the account access query and collapse duplicates from group and permission joins
    result = await db.execute(query)
    return list(result.scalars().unique().all())
