"""User profile and runway routes"""
import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.currency import Currency
from app.models.user import User
from app.routes.user_runway_account_helpers import (
    get_active_runway_account_ids,
    get_runway_account_ids_by_archive_state,
    get_runway_thresholds_from_user,
    replace_runway_account_ids,
)
from app.routes.user_runway_response_helpers import get_runway_response
from app.schemas.user import (
    CacheScopeStatus,
    CacheStatus,
    RunwayAccountsRequest,
    RunwayResponse,
    RunwaySettings,
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
    _non_nullable = {"first_name", "tz", "base_currency"}
    null_fields = [f for f in _non_nullable if f in updates and updates[f] is None]
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


@router.get("/runway-accounts", response_model=list[uuid.UUID])
async def list_runway_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the account IDs currently feeding the runway calculation

    Filters out any stored selections the user can no longer read or has
    archived, so the response only surfaces currently active IDs
    """
    active_account_ids = await get_active_runway_account_ids(db, user)
    return active_account_ids


@router.put("/runway-accounts", response_model=list[uuid.UUID])
async def replace_runway_accounts(
    data: RunwayAccountsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection with the submitted set

    Dedupes the submitted set and rejects the whole request with 422 if any submitted
    account isn't readable by the user (personal, household admin, or explicit
    permission) and currently non-archived while stored archived selections are
    preserved so they become active again if the account is unarchived
    """
    selected_ids = await replace_runway_account_ids(db, user, data.account_ids)
    await mark_user_cache_changed(db, user.id)
    await db.commit()

    return selected_ids


@router.get("/runway-settings", response_model=RunwaySettings)
async def get_runway_settings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the user's runway account selection and status thresholds"""
    active_account_ids, archived_account_ids = await get_runway_account_ids_by_archive_state(db, user)
    runway_settings = RunwaySettings(
        account_ids=active_account_ids,
        archived_account_ids=archived_account_ids,
        thresholds=get_runway_thresholds_from_user(user),
    )
    return runway_settings


@router.put("/runway-settings", response_model=RunwaySettings)
async def replace_runway_settings(
    data: RunwaySettings,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection and status thresholds"""
    await replace_runway_account_ids(db, user, data.account_ids)
    user.runway_risky_below_months = data.thresholds.risky_below_months
    user.runway_healthy_at_months = data.thresholds.healthy_at_months
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    active_account_ids, archived_account_ids = await get_runway_account_ids_by_archive_state(db, user)

    runway_settings = RunwaySettings(
        account_ids=active_account_ids,
        archived_account_ids=archived_account_ids,
        thresholds=get_runway_thresholds_from_user(user),
    )
    return runway_settings


@router.get("/runway", response_model=RunwayResponse)
async def get_runway(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Compute the user's cash runway in months

    Runway = (sum of current balance across selected runway accounts) divided
    by the average monthly net expense over the last 12 completed months
    Expense refunds reduce expenses, while income and transfer-category
    transactions are excluded
    """
    today = datetime.now(ZoneInfo(user.tz)).date()
    response = await get_runway_response(db, user, today)
    return response
