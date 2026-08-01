"""Merchant update helpers"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.routes.merchants.access_helpers import (
    get_accessible_merchant_or_404,
    require_default_category_available,
    require_editable_merchant,
    require_group_merchant_admin,
    require_merchant_name_available,
)
from app.schemas.merchant import UpdateMerchantRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def update_merchant_for_user(
    db: AsyncSession,
    merchant_id: uuid.UUID,
    user_id: uuid.UUID,
    data: UpdateMerchantRequest,
) -> Merchant:
    """Update a personal or group merchant for a user

    Group merchants require admin access

    Args:
        db: Active database session
        merchant_id: Merchant identifier from the route path
        user_id: Authenticated user identifier
        data: Merchant update payload

    Returns:
        Updated merchant

    Raises:
        HTTPException: Merchant is inaccessible, group admin access is missing, or merchant name already exists
    """
    merchant = await get_accessible_merchant_or_404(db, merchant_id, user_id)
    require_editable_merchant(merchant)
    await require_group_merchant_admin(db, merchant, user_id)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return merchant

    # Renaming goes through the same rule as creating, so nothing can be renamed onto a name that
    # ships with the app, or onto one already used in the same scope. The merchant itself is left
    # out of that comparison, so recapitalising its own name is still a rename it can make
    if "name" in updates and updates["name"] != merchant.name:
        await require_merchant_name_available(
            db, updates["name"], user_id, merchant.group_id, exclude_merchant_id=merchant.id,
        )

    if "default_category_id" in updates and updates["default_category_id"] is not None:
        await require_default_category_available(db, user_id, merchant.group_id, updates["default_category_id"])

    for field, value in updates.items():
        setattr(merchant, field, value)

    # Mark the merchant scope stale before committing merchant changes
    try:
        await mark_cache_changed_for_scope(db, user_id=merchant.owner_id, group_id=merchant.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Merchant with this name already exists",
        ) from e

    await db.refresh(merchant)
    return merchant
