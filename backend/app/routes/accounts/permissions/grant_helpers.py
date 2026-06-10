"""Account permission grant helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountPermission
from app.models.group import GroupMember
from app.routes.accounts.permissions.access_helpers import (
    get_account_admin_membership_or_403,
    get_group_account_or_404,
)
from app.schemas.permission import GrantAccountPermissionRequest
from app.services.cache_state import mark_group_cache_changed


async def grant_account_permission_to_member(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    data: GrantAccountPermissionRequest,
) -> AccountPermission:
    """Grant or update a member's access level on a group account

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: Authenticated user making the change
        data: Requested member and permission level

    Returns:
        Created or updated account permission row

    Raises:
        HTTPException: Account is not group-scoped, actor is not admin, or target member is invalid
    """
    account = await get_group_account_or_404(db, account_id)
    await get_account_admin_membership_or_403(db, account.group_id, user_id)
    await _get_non_admin_group_member_or_422(db, account.group_id, data.user_id)

    existing_permission = await _get_existing_account_permission(db, account, data.user_id)
    if existing_permission:
        existing_permission.level = data.level
        await mark_group_cache_changed(db, account.group_id)
        await db.commit()
        await db.refresh(existing_permission)
        return existing_permission

    account_permission = AccountPermission(
        group_id=account.group_id,
        user_id=data.user_id,
        account_id=account_id,
        level=data.level,
    )
    db.add(account_permission)
    await mark_group_cache_changed(db, account.group_id)
    await db.commit()
    await db.refresh(account_permission)
    return account_permission


async def _get_non_admin_group_member_or_422(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return a target member who can receive explicit account access

    Args:
        db: Active database session
        group_id: Group identifier for the account
        user_id: Target member user identifier

    Returns:
        Target group membership row

    Raises:
        HTTPException: Target user is not a group member or already has implicit admin access
    """
    target_member_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Confirm the target user belongs to the account group before granting explicit access
    result = await db.execute(target_member_query)
    target_member = result.scalar_one_or_none()
    if not target_member:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User is not a member of this group")
    if target_member.is_admin:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Admins have implicit full access")
    return target_member


async def _get_existing_account_permission(
    db: AsyncSession,
    account: Account,
    user_id: uuid.UUID,
) -> AccountPermission | None:
    """Return an existing account permission for a target member

    Args:
        db: Active database session
        account: Group-scoped account receiving the permission
        user_id: Target member user identifier

    Returns:
        Existing account permission row when one exists
    """
    permission_query = select(AccountPermission).where(
        AccountPermission.group_id == account.group_id,
        AccountPermission.user_id == user_id,
        AccountPermission.account_id == account.id,
    )

    # Look for an existing permission so repeated grants update the access level instead of duplicating rows
    result = await db.execute(permission_query)
    account_permission = result.scalar_one_or_none()
    return account_permission
