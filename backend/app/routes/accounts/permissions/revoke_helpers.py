"""Account permission revoke helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AccountPermission
from app.routes.accounts.permissions.access_helpers import (
    get_account_admin_membership_or_403,
    get_group_account_or_404,
)
from app.services.cache_state import mark_group_cache_changed


async def revoke_account_permission_for_admin(
    db: AsyncSession,
    account_id: uuid.UUID,
    permission_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Revoke a member's access to a group account after checking admin access

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        permission_id: Permission identifier from the route path
        user_id: Authenticated user making the change

    Raises:
        HTTPException: Account is not group-scoped, actor is not admin, or permission is missing
    """
    account = await get_group_account_or_404(db, account_id)
    await get_account_admin_membership_or_403(db, account.group_id, user_id)
    account_permission = await _get_account_permission_or_404(db, account_id, permission_id)

    await db.delete(account_permission)
    await mark_group_cache_changed(db, account.group_id)
    await db.commit()


async def _get_account_permission_or_404(
    db: AsyncSession,
    account_id: uuid.UUID,
    permission_id: uuid.UUID,
) -> AccountPermission:
    """Return a permission row within an account or raise not found

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        permission_id: Permission identifier from the route path

    Returns:
        Account permission row

    Raises:
        HTTPException: Permission does not exist within the account
    """
    permission_query = select(AccountPermission).where(
        AccountPermission.id == permission_id,
        AccountPermission.account_id == account_id,
    )

    # Fetch the permission row within the account so revocation cannot cross account boundaries
    result = await db.execute(permission_query)
    account_permission = result.scalar_one_or_none()
    if not account_permission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")
    return account_permission
