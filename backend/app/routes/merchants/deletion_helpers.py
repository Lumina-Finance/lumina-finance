"""Merchant deletion helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.merchants.access_helpers import get_accessible_merchant_or_404, require_group_merchant_admin
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_merchant_for_user(
    db: AsyncSession,
    merchant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete a personal or group merchant for a user

    Group merchants require admin access

    Args:
        db: Active database session
        merchant_id: Merchant identifier from the route path
        user_id: Authenticated user identifier

    Raises:
        HTTPException: Merchant is inaccessible, admin access is missing, or merchant is referenced
    """
    merchant = await get_accessible_merchant_or_404(db, merchant_id, user_id)
    await require_group_merchant_admin(db, merchant, user_id)

    # Delete the merchant and let the database reject existing transaction references
    await db.delete(merchant)

    # Surface merchant reference conflicts as a domain response instead of a raw integrity error
    try:
        await mark_cache_changed_for_scope(db, user_id=merchant.owner_id, group_id=merchant.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Merchant is referenced by existing transactions",
        ) from e
