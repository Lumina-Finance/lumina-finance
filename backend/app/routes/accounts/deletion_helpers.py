"""Account deletion helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.permissions import check_account_access
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_account_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete an account after checking admin access

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: User does not have admin access
    """
    account = await check_account_access(db, account_id, user_id, PermissionLevel.ADMIN)

    # Mark the account scope stale before deleting the account
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.delete(account)
    await db.commit()
