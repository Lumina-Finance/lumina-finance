"""Merchant creation helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.routes.merchants.access_helpers import (
    require_default_category_available,
    require_group_member,
    require_merchant_name_available,
)
from app.schemas.merchant import CreateMerchantRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def create_merchant_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: CreateMerchantRequest,
) -> Merchant:
    """Create a personal or group merchant for a user

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        data: Merchant creation payload

    Returns:
        Newly created merchant

    Raises:
        HTTPException: Group is inaccessible, merchant name already exists, or default category is invalid
    """
    group_id = data.group_id
    if group_id is not None:
        await require_group_member(db, group_id, user_id)

    await require_merchant_name_available(db, data.name, user_id, group_id)
    await require_default_category_available(db, user_id, group_id, data.default_category_id)

    merchant = Merchant(
        owner_id=user_id,
        group_id=group_id,
        name=data.name,
        default_category_id=data.default_category_id,
    )
    db.add(merchant)

    # Mark the merchant scope stale before committing the newly created merchant
    await mark_cache_changed_for_scope(db, user_id=merchant.owner_id, group_id=merchant.group_id)
    await db.commit()
    await db.refresh(merchant)
    return merchant
