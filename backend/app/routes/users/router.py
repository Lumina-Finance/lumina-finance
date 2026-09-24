"""User profile routes"""
import hashlib
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import TaxAdvantagedCategory
from app.models.currency import Currency
from app.models.group import Group
from app.models.user import User
from app.schemas.user import (
    CacheScopeStatus,
    CacheStatus,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.cache_state import get_visible_cache_status, mark_user_cache_changed, select_user_group_ids
from app.services.tax_advantaged_categories import get_category_owner_timezones
from app.utils.dates import resolve_timezone

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
    """Return visible cache changes and the next local calculation boundary"""
    status = await get_visible_cache_status(db, user.id)
    current_date, date_token, next_boundary = await _get_calculation_date_boundary(db, user)
    cache_status = CacheStatus(
        changed_at=status.changed_at,
        current_date=current_date,
        calculation_date_token=date_token,
        next_calculation_boundary_at=next_boundary,
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


async def _get_calculation_date_boundary(db: AsyncSession, user: User) -> tuple[date, str, datetime]:
    """Return a date token and the next midnight for every visible calculation owner."""
    group_ids = select_user_group_ids(user.id)
    group_owner_ids = set((await db.scalars(select(Group.owner_id).where(Group.id.in_(group_ids)))).all())
    category_owner_ids = set((await db.scalars(
        select(TaxAdvantagedCategory.category_owner_user_id)
        .where(TaxAdvantagedCategory.group_id.in_(group_ids)),
    )).all())
    other_owner_ids = (group_owner_ids | category_owner_ids) - {user.id}
    owner_timezones = await get_category_owner_timezones(db, other_owner_ids)
    owner_timezones[user.id] = resolve_timezone(user.tz)

    now = datetime.now(UTC)
    local_dates = {owner_id: now.astimezone(zone).date() for owner_id, zone in owner_timezones.items()}
    token_source = "|".join(f"{owner_id}:{local_dates[owner_id]}" for owner_id in sorted(local_dates))
    date_token = hashlib.sha256(token_source.encode()).hexdigest()
    next_boundary = min(
        datetime.combine(local_dates[owner_id] + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
        for owner_id, zone in owner_timezones.items()
    )
    return local_dates[user.id], date_token, next_boundary


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
