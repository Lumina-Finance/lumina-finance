"""User profile routes"""

import hashlib
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.runtime import APP_VERSION
from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import TaxAdvantagedCategory
from app.models.group import Group
from app.models.user import User
from app.schemas.user import (
    CacheScopeStatus,
    CacheStatus,
    FeatureGrants,
    RatesStatus,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.allowance.currency import find_foreign_currencies_reason, find_foreign_currencies_token
from app.services.allowance.require import list_granted_features
from app.services.cache_state import get_shared_cache_changed_at, get_visible_cache_status, select_user_group_ids
from app.services.csv_export import download_response
from app.services.data_export.archive import ZIP_MEDIA_TYPE, start_data_export
from app.services.fx.rates_status import get_rates_digest, holds_group_other_currencies, holds_other_currencies
from app.services.tax_advantaged_categories import get_category_owner_timezones
from app.services.users.profile import build_user_profile
from app.services.users.profile_update import update_user_profile
from app.utils.dates import resolve_timezone

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserProfile)
async def get_me(
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the authenticated user's full profile"""
    return await build_user_profile(user)


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
        foreign_currencies_token=await find_foreign_currencies_token(user.id),
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
        shared_changed_at=await get_shared_cache_changed_at(db),
        server_version=APP_VERSION,
    )
    return cache_status


@router.get("/feature-grants", response_model=FeatureGrants)
async def get_feature_grants(
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the features the installed allowance check lets the user use"""
    return FeatureGrants(features=await list_granted_features(user.id))


@router.get("/rates-status", response_model=RatesStatus)
async def get_rates_status(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a digest of the recent exchange rates behind the user's converted figures"""
    other_currencies = await holds_other_currencies(db, user.base_currency)
    withholds_conversion = (
        other_currencies
        and await find_foreign_currencies_reason(user.id) is not None
        and not await holds_group_other_currencies(db, user.base_currency)
    )
    return RatesStatus(
        digest=await get_rates_digest(user.id, holds_other_currencies=other_currencies, withholds_conversion=withholds_conversion)
    )


@router.get("/export", response_class=StreamingResponse)
async def export_data(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Stream a ZIP of CSV files holding everything the user owns, as of one moment

    Reads only, so it marks no change and commits nothing

    Args:
        user: Authenticated user exporting their data
        db: Active database session

    Returns:
        A ZIP download with one CSV file for each kind of data
    """
    export = await start_data_export(db, user)
    return download_response(export.chunks, export.filename, ZIP_MEDIA_TYPE)


async def _get_calculation_date_boundary(db: AsyncSession, user: User) -> tuple[date, str, datetime]:
    """Return a date token and the next midnight for every visible calculation owner."""
    group_ids = select_user_group_ids(user.id)
    group_owner_ids = set((await db.scalars(select(Group.owner_id).where(Group.id.in_(group_ids)))).all())
    category_owner_ids = set(
        (
            await db.scalars(
                select(TaxAdvantagedCategory.category_owner_user_id).where(TaxAdvantagedCategory.group_id.in_(group_ids)),
            )
        ).all()
    )
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
    return await update_user_profile(db, user, data)
