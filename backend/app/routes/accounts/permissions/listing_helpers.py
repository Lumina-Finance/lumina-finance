"""Account permission listing helpers"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AccountPermission
from app.routes.accounts.permissions.access_helpers import (
    get_account_admin_membership_or_403,
    get_group_account_or_404,
)


async def get_account_permissions_for_admin(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    filtered_user_id: uuid.UUID | None = None,
) -> list[AccountPermission]:
    """Return permissions for a group account after checking admin access

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: Authenticated user requesting permissions
        filtered_user_id: Optional user filter for permission rows

    Returns:
        Account permission rows ordered by creation time

    Raises:
        HTTPException: Account is not group-scoped or actor is not admin
    """
    account = await get_group_account_or_404(db, account_id)
    await get_account_admin_membership_or_403(db, account.group_id, user_id)

    permissions_query = select(AccountPermission).where(AccountPermission.account_id == account_id)
    if filtered_user_id:
        permissions_query = permissions_query.where(AccountPermission.user_id == filtered_user_id)

    # Fetch permission rows for the group account, optionally narrowed to one member
    result = await db.execute(permissions_query.order_by(AccountPermission.created_at))
    account_permissions = result.scalars().all()
    return account_permissions
