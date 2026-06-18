"""Account creation scope helpers"""
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group, GroupMember
from app.models.user import User


@dataclass(frozen=True)
class AccountCreationScope:
    """Resolved ownership and date-anchor details for a new account

    Attributes:
        owner_id: User identifier for personal account ownership
        group_id: Group identifier for group account ownership
        anchor_tz: Timezone used for initial balance dates
    """

    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    anchor_tz: str


async def resolve_account_creation_scope(
    db: AsyncSession,
    user: User,
    group_id: uuid.UUID | None,
) -> AccountCreationScope:
    """Return ownership and date-anchor details for a new account

    Args:
        db: Active database session
        user: Authenticated user creating the account
        group_id: Optional group identifier from the request

    Returns:
        Ownership and date-anchor details for account creation

    Raises:
        HTTPException: Group does not exist or user cannot create group accounts
    """
    if group_id is None:
        return AccountCreationScope(owner_id=user.id, group_id=None, anchor_tz=user.tz)

    membership = await _get_group_membership_or_404(db, group_id, user.id)
    _raise_for_missing_group_admin_access(membership)
    return AccountCreationScope(
        owner_id=None,
        group_id=group_id,
        anchor_tz=await _get_group_owner_timezone_or_404(db, group_id),
    )


async def _get_group_membership_or_404(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return the user's group membership or raise a not-found response

    Args:
        db: Active database session
        group_id: Group identifier from the request
        user_id: User identifier for the acting user

    Returns:
        Group membership for the acting user

    Raises:
        HTTPException: User is not a member of the requested group
    """
    # Fetch the acting user's membership so group-account creation can enforce admin access
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return membership


def _raise_for_missing_group_admin_access(membership: GroupMember) -> None:
    """Raise when a group member cannot create group accounts

    Args:
        membership: Group membership for the acting user

    Raises:
        HTTPException: User is not a group admin
    """
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create group accounts")


async def _get_group_owner_timezone_or_404(db: AsyncSession, group_id: uuid.UUID) -> str:
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
        select(func.public.user_tz(Group.owner_id)).where(Group.id == group_id),
    )
    if group_owner_tz is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group_owner_tz
