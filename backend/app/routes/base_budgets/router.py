"""Base budget route handlers"""
import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_base_budget_access
from app.routes.base_budgets.creation_helpers import create_base_budget_and_get_response
from app.routes.base_budgets.deletion_helpers import delete_base_budget_for_user
from app.routes.base_budgets.instance_helpers import create_budget_instance_and_get_response
from app.routes.base_budgets.listing_helpers import get_visible_base_budget_responses
from app.routes.base_budgets.permissions import router as permissions_router
from app.routes.base_budgets.response_helpers import get_base_budget_response
from app.routes.base_budgets.update_helpers import update_base_budget_and_get_response
from app.routes.base_budgets.utilization_helpers import get_base_budget_utilizations_for_user
from app.schemas.budget import (
    BaseBudgetResponse,
    BudgetResponse,
    BudgetUtilizationResponse,
    CreateBaseBudgetRequest,
    CreateBudgetRequest,
    UpdateBaseBudgetRequest,
)

router = APIRouter(prefix="/base-budgets", tags=["base-budgets"])
router.include_router(permissions_router)


@router.patch("/{base_budget_id}", response_model=BaseBudgetResponse)
async def update_base_budget(
    base_budget_id: uuid.UUID,
    data: UpdateBaseBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a base budget

    Args:
        base_budget_id: Base budget identifier from the route path
        data: Base budget fields to update
        user: Authenticated user updating the base budget
        db: Active database session

    Returns:
        Updated base budget response

    Raises:
        HTTPException: User lacks admin access or update fields are invalid
    """
    today = datetime.now(ZoneInfo(user.tz)).date()
    return await update_base_budget_and_get_response(db, user, base_budget_id, data, today)


@router.delete("/{base_budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_base_budget(
    base_budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a base budget

    Args:
        base_budget_id: Base budget identifier from the route path
        user: Authenticated user deleting the base budget
        db: Active database session

    Raises:
        HTTPException: User lacks admin access
    """
    await delete_base_budget_for_user(db, user.id, base_budget_id)


@router.get("/{base_budget_id}", response_model=BaseBudgetResponse)
async def get_base_budget(
    base_budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single base budget

    Args:
        base_budget_id: Base budget identifier from the route path
        user: Authenticated user requesting the base budget
        db: Active database session

    Returns:
        Base budget response

    Raises:
        HTTPException: User lacks read access
    """
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.READ)
    return await get_base_budget_response(db, base_budget)


@router.get("/{base_budget_id}/utilizations", response_model=list[BudgetUtilizationResponse])
async def get_base_budget_utilizations(
    base_budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return per-category spending totals for every period of a base budget

    Requires read access on the base budget. Each period reconstructs its
    tracked-category set as of period end so past periods stay frozen when the
    base is edited after they ended. Mid-period additions count for the full
    period retroactively, while mid-period removals exclude the category from the
    whole period

    Args:
        base_budget_id: Base budget identifier from the route path
        user: Authenticated user requesting utilization
        db: Active database session

    Returns:
        Budget utilization responses ordered by period start ascending

    Raises:
        HTTPException: User does not have read access
    """
    return await get_base_budget_utilizations_for_user(db, base_budget_id, user.id)


@router.get("", response_model=list[BaseBudgetResponse])
async def get_base_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return base budgets visible to the user

    Args:
        user: Authenticated user requesting base budgets
        db: Active database session

    Returns:
        Base budget responses visible through ownership, group admin membership, or explicit permission
    """
    return await get_visible_base_budget_responses(db, user.id)


@router.post("", response_model=BaseBudgetResponse, status_code=status.HTTP_201_CREATED)
async def create_base_budget(
    data: CreateBaseBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new base budget

    Args:
        data: Base budget creation request body
        user: Authenticated user creating the base budget
        db: Active database session

    Returns:
        Created base budget response

    Raises:
        HTTPException: Currency, ownership, categories, or period cadence are invalid
    """
    today = datetime.now(ZoneInfo(user.tz)).date()
    return await create_base_budget_and_get_response(db, user, data, today)


@router.post(
    "/{base_budget_id}/budgets",
    response_model=BudgetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_budget_instance(
    base_budget_id: uuid.UUID,
    data: CreateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a period budget instance under a base budget

    Args:
        base_budget_id: Base budget identifier from the route path
        data: Budget instance creation request body
        user: Authenticated user creating the budget instance
        db: Active database session

    Returns:
        Created budget instance response

    Raises:
        HTTPException: User lacks admin access, period start is invalid, or period overlaps
    """
    return await create_budget_instance_and_get_response(db, user.id, base_budget_id, data)
