"""Runway routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.runway.account_helpers import (
    get_active_runway_account_ids,
    get_runway_account_ids_by_archive_state,
    get_runway_thresholds_from_user,
    replace_runway_account_ids,
)
from app.routes.runway.response_helpers import get_runway_response
from app.routes.users.date_helpers import get_current_user_date
from app.schemas.user import (
    RunwayAccountsRequest,
    RunwayResponse,
    RunwaySettings,
)
from app.services.cache_state import mark_user_cache_changed

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/runway-accounts", response_model=list[uuid.UUID])
async def get_runway_accounts(
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

    Raises:
        HTTPException: The stored timezone does not resolve
    """
    today = get_current_user_date(user)
    response = await get_runway_response(db, user, today)
    return response
