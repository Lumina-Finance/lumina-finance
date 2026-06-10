"""Account permission access helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.group import GroupMember


async def get_group_account_or_404(db: AsyncSession, account_id: uuid.UUID) -> Account:
    """Return a group-scoped account or raise not found

    Args:
        db: Active database session
        account_id: Account identifier from the route path

    Returns:
        Group-scoped account row

    Raises:
        HTTPException: Account is missing or personal
    """
    account_query = select(Account).where(Account.id == account_id)

    # Fetch the account row and reject personal accounts because permissions apply only to group accounts
    result = await db.execute(account_query)
    account = result.scalar_one_or_none()
    if not account or not account.group_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


async def get_account_admin_membership_or_403(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return group membership when the user can manage account permissions

    Args:
        db: Active database session
        group_id: Group identifier for the account
        user_id: Authenticated user identifier

    Returns:
        Group membership for an admin user

    Raises:
        HTTPException: User is not a member or is not an admin
    """
    membership_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the actor's group membership to enforce admin-only permission changes
    result = await db.execute(membership_query)
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership
