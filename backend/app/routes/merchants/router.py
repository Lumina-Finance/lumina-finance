"""Merchant routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.merchants.access_helpers import (
    get_accessible_merchant_or_404,
    require_group_merchant_admin,
)
from app.routes.merchants.merchant_creation_helpers import create_merchant_for_user
from app.routes.merchants.merchant_listing_helpers import get_merchants_for_user
from app.routes.merchants.merchant_update_helpers import update_merchant_for_user
from app.routes.merchants.merge_helpers import merge_merchant_into_replacement_for_user
from app.schemas.merchant import CreateMerchantRequest, MerchantResponse, MergeMerchantRequest, UpdateMerchantRequest
from app.services.cache_state import mark_cache_changed_for_scope

router = APIRouter(prefix="/merchants", tags=["merchants"])


@router.get("", response_model=list[MerchantResponse])
async def list_merchants(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    group_id: Annotated[uuid.UUID | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int | None, Query(ge=1, le=50)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return merchants visible in the requested scope

    Args:
        user: Authenticated user requesting merchants
        db: Active database session
        group_id: Optional group scope to include with personal merchants
        q: Optional name search text
        limit: Optional maximum number of merchants to return
        offset: Number of merchants to skip before returning rows

    Returns:
        Merchants ordered by name
    """
    merchants = await get_merchants_for_user(db, user.id, group_id, q, limit, offset)
    return merchants


@router.get("/{merchant_id}", response_model=MerchantResponse)
async def get_merchant(
    merchant_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a merchant visible to the user

    Args:
        merchant_id: Merchant identifier from the route path
        user: Authenticated user requesting the merchant
        db: Active database session

    Returns:
        Merchant visible to the user
    """
    merchant = await get_accessible_merchant_or_404(db, merchant_id, user.id)
    return merchant


@router.post("", response_model=MerchantResponse, status_code=status.HTTP_201_CREATED)
async def create_merchant(
    data: CreateMerchantRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a personal or group merchant

    Args:
        data: Merchant creation payload
        user: Authenticated user creating the merchant
        db: Active database session

    Returns:
        Newly created merchant
    """
    merchant = await create_merchant_for_user(db, user.id, data)
    return merchant


@router.patch("/{merchant_id}", response_model=MerchantResponse)
async def update_merchant(
    merchant_id: uuid.UUID,
    data: UpdateMerchantRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a personal or group merchant

    Group merchants require admin access

    Args:
        merchant_id: Merchant identifier from the route path
        data: Merchant update payload
        user: Authenticated user updating the merchant
        db: Active database session

    Returns:
        Updated merchant
    """
    merchant = await update_merchant_for_user(db, merchant_id, user.id, data)
    return merchant


@router.post("/{merchant_id}/merge", status_code=status.HTTP_204_NO_CONTENT)
async def merge_merchant(
    merchant_id: uuid.UUID,
    data: MergeMerchantRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Merge a merchant into a replacement merchant

    Args:
        merchant_id: Merchant identifier from the route path
        data: Merge payload with the replacement merchant
        user: Authenticated user merging the merchant
        db: Active database session
    """
    await merge_merchant_into_replacement_for_user(db, merchant_id, data.replacement_merchant_id, user.id)


@router.delete("/{merchant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_merchant(
    merchant_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a personal or group merchant

    Group merchants require admin access

    Args:
        merchant_id: Merchant identifier from the route path
        user: Authenticated user deleting the merchant
        db: Active database session
    """
    merchant = await get_accessible_merchant_or_404(db, merchant_id, user.id)
    await require_group_merchant_admin(db, merchant, user.id)

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
