"""User profile routes"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.currency import Currency
from app.models.user import User
from app.schemas.user import (
    CacheScopeStatus,
    CacheStatus,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.cache_state import get_visible_cache_status, mark_user_cache_changed

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserProfile)
async def get_me(
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the authenticated user's full profile"""
    profile = UserProfile.model_validate(user)
    return profile


@router.get("/cache-status", response_model=CacheStatus)
async def get_cache_status(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the latest app-data change timestamp visible to the user"""
    status = await get_visible_cache_status(db, user.id)
    cache_status = CacheStatus(
        changed_at=status.changed_at,
        personal=CacheScopeStatus(
            changed_at=status.personal.changed_at,
            last_change_from_current_session=status.personal.last_change_from_current_session,
        ),
        groups={
            group_id: CacheScopeStatus(
                changed_at=group_status.changed_at,
                last_change_from_current_session=group_status.last_change_from_current_session,
            )
            for group_id, group_status in status.groups.items()
        },
    )
    return cache_status


@router.patch("", response_model=UserProfile)
async def update_me(
    data: UpdateProfileRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the authenticated user's profile"""
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        profile = UserProfile.model_validate(user)
        return profile

    # Non-nullable fields cannot be explicitly set to null
    non_nullable_fields = {"first_name", "tz", "base_currency"}
    null_fields = [field for field in non_nullable_fields if field in updates and updates[field] is None]
    if null_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Cannot set to null: {', '.join(sorted(null_fields))}",
        )

    if "base_currency" in updates:
        base_currency = updates["base_currency"]

        # Fetch the target currency so users cannot save an unsupported base currency
        result = await db.execute(select(Currency).where(Currency.id == base_currency))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    for field, value in updates.items():
        setattr(user, field, value)

    await mark_user_cache_changed(db, user.id)
    await db.commit()
    profile = UserProfile.model_validate(user)
    return profile
