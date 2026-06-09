"""Base budget route handlers"""
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.user import User
from app.permissions import check_base_budget_access
from app.routes.base_budgets.listing import get_visible_base_budget_responses
from app.routes.base_budgets.permissions import router as permissions_router
from app.routes.base_budgets.responses import get_base_budget_response, get_budget_instance_response
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


async def _check_group_admin_or_403(
    db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID,
) -> GroupMember:
    """Return group membership when a user can manage base budgets

    Args:
        db: Active database session
        group_id: Group identifier for the base budget
        user_id: Authenticated user identifier

    Returns:
        Group membership for an admin user

    Raises:
        HTTPException: Group is missing or user is not an admin
    """
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can manage base budgets")
    return membership


async def _validate_category_ids(
    db: AsyncSession, category_ids: list[uuid.UUID], user_id: uuid.UUID, group_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """Return valid tracked category identifiers for a base budget

    Scope rules:
    - Personal base budget: system categories or the user's own personal categories
    - Group base budget: system categories or categories owned by the same group

    Mixing scopes (e.g., a group base budget tracking a personal category) is rejected
    so every group member sees the same tracked-category set and the same totals

    Args:
        db: Active database session
        category_ids: Requested tracked category identifiers
        user_id: Authenticated user identifier
        group_id: Optional group scope for the base budget

    Returns:
        Deduplicated category identifiers

    Raises:
        HTTPException: A category is missing or outside the base budget scope
    """
    if not category_ids:
        return []
    unique_ids = list(set(category_ids))
    query = select(Category.id).where(Category.id.in_(unique_ids))
    if group_id:
        query = query.where(Category.is_system.is_(True) | (Category.group_id == group_id))
    else:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )
    result = await db.execute(query)
    found = set(result.scalars().all())
    if found != set(unique_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return unique_ids


def _initial_budget_period_starts(base_budget: BaseBudget, period_start: date, today: date) -> list[date]:
    """Return initial period starts for a base budget

    Args:
        base_budget: Base budget row being created
        period_start: First requested period start date
        today: Current date in the user's timezone

    Returns:
        Period start dates to materialize
    """
    starts = [period_start]
    if not base_budget.recurs:
        return starts

    next_start = period_start
    while True:
        period_end = compute_period_end(
            next_start,
            base_budget.recurrence_freq,
            base_budget.instance_length,
            dom=base_budget.recurrence_dom,
            month=base_budget.recurrence_month,
        )
        next_start = period_end + timedelta(days=1)
        if next_start > today:
            return starts
        starts.append(next_start)


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

    # Update tracked categories if provided — soft-delete removed, insert new
    if new_category_ids is not None:
        today = datetime.now(ZoneInfo(user.tz)).date()
        validated = set(await _validate_category_ids(db, new_category_ids, user.id, base_budget.group_id))
        current_result = await db.execute(
            select(BudgetTrackedCategory.category_id).where(
                BudgetTrackedCategory.base_budget_id == base_budget_id,
                BudgetTrackedCategory.removed_at.is_(None),
            ),
        )
        current = set(current_result.scalars().all())

        # Soft-delete categories no longer tracked
        removed = current - validated
        if removed:
            await db.execute(
                sa.update(BudgetTrackedCategory)
                .where(
                    BudgetTrackedCategory.base_budget_id == base_budget_id,
                    BudgetTrackedCategory.category_id.in_(removed),
                    BudgetTrackedCategory.removed_at.is_(None),
                )
                .values(removed_at=today),
            )

        # Insert newly added categories
        added = validated - current
        for cat_id in added:
            db.add(BudgetTrackedCategory(base_budget_id=base_budget_id, category_id=cat_id, added_at=today))

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
async def list_base_budgets(
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
    # Validate currency exists
    currency_result = await db.execute(select(Currency).where(Currency.id == data.currency))
    if not currency_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    # Determine ownership
    owner_id = user.id
    group_id = data.group_id
    if group_id:
        await _check_group_admin_or_403(db, group_id, user.id)
        owner_id = None

    # Validate tracked category IDs
    validated_cat_ids = await _validate_category_ids(db, data.category_ids, user.id, group_id)

    if data.period_start is not None:
        alignment_error = validate_period_start(
            data.period_start,
            data.recurrence_freq,
            weekday=data.recurrence_weekday,
            dom=data.recurrence_dom,
            month=data.recurrence_month,
        )
        if alignment_error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=alignment_error,
            )

    base_budget = BaseBudget(
        owner_id=owner_id,
        group_id=group_id,
        name=data.name,
        currency=data.currency,
        recurrence_freq=data.recurrence_freq,
        instance_length=data.instance_length,
        recurrence_weekday=data.recurrence_weekday,
        recurrence_dom=data.recurrence_dom,
        recurrence_month=data.recurrence_month,
        recurs=data.recurs,
    )
    db.add(base_budget)
    await db.flush()

    # Link tracked categories
    today = datetime.now(ZoneInfo(user.tz)).date()
    category_added_at = data.period_start or today
    for cat_id in validated_cat_ids:
        db.add(BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=cat_id, added_at=category_added_at))

    if data.period_start is not None and data.overall_limit is not None:
        for period_start in _initial_budget_period_starts(base_budget, data.period_start, today):
            db.add(
                Budget(
                    base_budget_id=base_budget.id,
                    period_start=period_start,
                    period_end=compute_period_end(
                        period_start,
                        base_budget.recurrence_freq,
                        base_budget.instance_length,
                        dom=base_budget.recurrence_dom,
                        month=base_budget.recurrence_month,
                    ),
                    overall_limit=data.overall_limit,
                ),
            )

    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(base_budget)
    return await get_base_budget_response(db, base_budget)


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

    # Block overlapping instances — two ranges overlap when each starts before the other ends
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
