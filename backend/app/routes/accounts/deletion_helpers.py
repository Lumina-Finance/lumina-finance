"""Account deletion helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
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
        HTTPException: User does not have admin access, or transfers elsewhere record this account
    """
    account = await check_account_access(db, account_id, user_id, PermissionLevel.ADMIN)

    # Mark the account scope stale before deleting the account
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.delete(account)

    # Transfers in other accounts record this one as the other side, and the restricting foreign key
    # rejects the delete rather than letting those rows lose what they recorded. Transactions inside
    # this account cascade away with it and never reach here
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account is recorded as the other side of transfers in other accounts",
        ) from e
