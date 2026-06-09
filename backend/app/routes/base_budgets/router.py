"""Base budget route handlers"""
import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import PermissionLevel
from app.models.budget import Budget
from app.models.user import User
from app.permissions import check_base_budget_access
from app.routes.base_budgets.category_helpers import update_tracked_category_links
from app.routes.base_budgets.creation_helpers import create_base_budget_and_get_response
from app.routes.base_budgets.listing_helpers import get_visible_base_budget_responses
from app.routes.base_budgets.permissions import router as permissions_router
from app.routes.base_budgets.response_helpers import get_base_budget_response, get_budget_instance_response
from app.schemas.budget import (
    BaseBudgetResponse,
    BudgetResponse,
    CreateBaseBudgetRequest,
    CreateBudgetRequest,
    UpdateBaseBudgetRequest,
)
from app.services.budget_periods import compute_period_end, validate_period_start
from app.services.cache_state import mark_cache_changed_for_scope

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
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.ADMIN)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await get_base_budget_response(db, base_budget)

    # Handle tracked categories separately from simple field updates
    new_category_ids = changed_fields.pop("category_ids", None)

    for field, value in changed_fields.items():
        setattr(base_budget, field, value)

    # Update tracked categories when the PATCH body includes category_ids
    if new_category_ids is not None:
        today = datetime.now(ZoneInfo(user.tz)).date()
        await update_tracked_category_links(
            db,
            base_budget_id,
            new_category_ids,
            user.id,
            base_budget.group_id,
            today,
        )

    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(base_budget)
    return await get_base_budget_response(db, base_budget)


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
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.ADMIN)
    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.delete(base_budget)
    await db.commit()


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
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.ADMIN)

    # Validate period_start alignment against the base's cadence
    alignment_error = validate_period_start(
        data.period_start,
        base_budget.recurrence_freq,
        weekday=base_budget.recurrence_weekday,
        dom=base_budget.recurrence_dom,
        month=base_budget.recurrence_month,
    )
    if alignment_error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=alignment_error,
        )

    # Compute period_end from the base's cadence
    period_end = compute_period_end(
        data.period_start,
        base_budget.recurrence_freq,
        base_budget.instance_length,
        dom=base_budget.recurrence_dom,
        month=base_budget.recurrence_month,
    )

    # Block overlapping instances because two ranges overlap when each starts before the other ends
    overlap_result = await db.execute(
        select(Budget).where(
            Budget.base_budget_id == base_budget_id,
            Budget.period_start <= period_end,
            Budget.period_end >= data.period_start,
        ),
    )
    if overlap_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A budget instance already exists for this period",
        )

    budget = Budget(
        base_budget_id=base_budget_id,
        period_start=data.period_start,
        period_end=period_end,
        overall_limit=data.overall_limit,
    )
    db.add(budget)
    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(budget)

    return await get_budget_instance_response(db, budget, base_budget)
