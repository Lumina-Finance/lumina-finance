"""Account permission checks"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account, AccountPermission
from app.models.base import PermissionLevel
from app.models.group import GroupMember
from app.permissions.levels import is_permission_level_at_least


async def check_account_access(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
    *,
    require_open: bool = False,
) -> Account:
    """Return an account when the user has the required access level

    The check grants full access to personal owners and group admins before
    checking explicit account permissions

    Args:
        db: Active database session
        account_id: Account identifier to check
        user_id: User requesting access
        required_level: Minimum permission level required by the operation
        require_open: Whether closed accounts should be rejected

    Returns:
        Account row with institution data loaded

    Raises:
        HTTPException: Account is missing, inaccessible, closed, or below the required permission level
    """
    account = await _get_account_or_404(db, account_id)
    is_authorized = account.owner_id == user_id

    if not is_authorized and account.group_id:
        is_authorized = await _is_group_account_access_allowed(
            db,
            account_id,
            account.group_id,
            user_id,
            required_level,
        )

    if not is_authorized:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    if require_open and account.closed_at is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is closed")

    return account


async def _get_account_or_404(db: AsyncSession, account_id: uuid.UUID) -> Account:
    """Return an account with response data loaded or raise not found

    Args:
        db: Active database session
        account_id: Account identifier to fetch

    Returns:
        Account row with institution data loaded

    Raises:
        HTTPException: Account does not exist
    """
    account_query = select(Account).where(Account.id == account_id).options(selectinload(Account.institution))

    # Fetch the account with institution data so response builders can serialize it in async contexts
    result = await db.execute(account_query)
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


async def _is_group_account_access_allowed(
    db: AsyncSession,
    account_id: uuid.UUID,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
) -> bool:
    """Return whether group membership or permission allows account access

    Args:
        db: Active database session
        account_id: Account identifier to check
        group_id: Group that owns the account
        user_id: User requesting access
        required_level: Minimum permission level required by the operation

    Returns:
        Whether the user has access through group admin status or an explicit permission

    Raises:
        HTTPException: User is not a group member or has insufficient explicit access
    """
    membership = await _get_group_membership_for_account(db, group_id, user_id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if membership.is_admin:
        return True

    account_permission = await _get_account_permission(db, account_id, user_id)
    if not account_permission:
        return False
    if is_permission_level_at_least(account_permission.level, required_level):
        return True

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


async def _get_group_membership_for_account(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember | None:
    """Return the user's membership in an account-owning group

    Args:
        db: Active database session
        group_id: Group that owns the account
        user_id: User requesting access

    Returns:
        Group membership row when the user belongs to the group
    """
    membership_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the group membership so non-members see the account as not found
    result = await db.execute(membership_query)
    membership = result.scalar_one_or_none()
    return membership


async def _get_account_permission(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AccountPermission | None:
    """Return an explicit account permission for a user

    Args:
        db: Active database session
        account_id: Account identifier to check
        user_id: User requesting access

    Returns:
        Explicit account permission row when one exists
    """
    permission_query = select(AccountPermission).where(
        AccountPermission.account_id == account_id,
        AccountPermission.user_id == user_id,
    )

    # Fetch the explicit account permission used for non-admin group members
    result = await db.execute(permission_query)
    account_permission = result.scalar_one_or_none()
    return account_permission
