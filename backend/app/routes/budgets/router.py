"""Budget route handlers"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, Budget, BudgetPermission
from app.models.group import GroupMember
from app.models.user import User
from app.permissions import check_budget_access
from app.schemas.budget import (
    BudgetResponse,
    BudgetUtilizationResponse,
    LatestBudgetUtilizationResponse,
    UpdateBudgetRequest,
)
from app.services.budget_responses import build_budget_response, load_tracked_categories
from app.services.budgets.listing import get_visible_budget_responses
from app.services.budgets.utilization import get_budget_utilization_responses
from app.services.cache_state import mark_cache_changed_for_scope

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _build_budget_response(
    db: AsyncSession, budget: Budget, base_budget: BaseBudget,
) -> BudgetResponse:
    """Return a budget instance response

    Args:
        db: Active database session
        budget: Budget instance row
        base_budget: Parent base budget row

    Returns:
        Budget instance response with tracked category IDs from the parent base budget
    """
    tracked_categories_by_base_budget = await load_tracked_categories(db, [base_budget.id])
    return build_budget_response(budget, base_budget, tracked_categories_by_base_budget.get(base_budget.id, []))


@router.get("/latest-utilizations", response_model=list[LatestBudgetUtilizationResponse])
async def get_latest_budget_utilizations(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return latest utilization for each accessible base budget

    Args:
        user: Authenticated user requesting utilization
        db: Active database session

    Returns:
        Latest budget utilization responses ordered by base budget name
    """
    ranked_budget_ids = (
        select(
            Budget.id.label("budget_id"),
            func.row_number()
            .over(
                partition_by=Budget.base_budget_id,
                order_by=(Budget.period_start.desc(), Budget.created_at.desc()),
            )
            .label("rank"),
        )
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .outerjoin(GroupMember, BaseBudget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.base_budget_id == BaseBudget.id) & (BudgetPermission.user_id == user.id),
        )
        .where(
            (BaseBudget.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user.id),
        )
        .subquery()
    )
    result = await db.execute(
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(ranked_budget_ids, Budget.id == ranked_budget_ids.c.budget_id)
        .where(ranked_budget_ids.c.rank == 1)
        .order_by(BaseBudget.name),
    )
    budget_rows = result.all()
    utilizations = await get_budget_utilization_responses(db, budget_rows)
    return [
        LatestBudgetUtilizationResponse(
            **utilization.model_dump(),
            base_budget_id=base_budget.id,
            name=base_budget.name,
            currency=base_budget.currency,
        )
        for utilization, (_, base_budget) in zip(utilizations, budget_rows, strict=True)
    ]


@router.get("/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single budget instance

    Args:
        budget_id: Budget instance identifier from the route path
        user: Authenticated user requesting the budget instance
        db: Active database session

    Returns:
        Budget instance response

    Raises:
        HTTPException: User does not have read access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    return await _build_budget_response(db, budget, base_budget)


@router.get("/{budget_id}/utilization", response_model=BudgetUtilizationResponse)
async def get_budget_utilization(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return per-category spending totals for a budget period

    Requires read access on the base budget. The tracked-category set is
    reconstructed as of period end so past periods stay frozen when the base is
    edited after they ended. Mid-period additions count for the full period
    retroactively, while mid-period removals exclude the category from the whole
    period

    Args:
        budget_id: Budget instance identifier from the route path
        user: Authenticated user requesting utilization
        db: Active database session

    Returns:
        Budget utilization response

    Raises:
        HTTPException: User does not have read access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    responses = await get_budget_utilization_responses(db, [(budget, base_budget)])
    return responses[0]


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a budget instance

    Args:
        budget_id: Budget instance identifier from the route path
        user: Authenticated user deleting the budget instance
        db: Active database session

    Raises:
        HTTPException: User does not have admin access
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)
    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.delete(budget)
    await db.commit()


@router.patch("/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: uuid.UUID,
    data: UpdateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a budget instance

    Period dates are derived from the base budget cadence and cannot be edited.
    Users create a new instance when they need a different period

    Args:
        budget_id: Budget instance identifier from the route path
        data: Budget instance fields to update
        user: Authenticated user updating the budget instance
        db: Active database session

    Returns:
        Updated budget instance response

    Raises:
        HTTPException: User does not have admin access or update fields are invalid
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await _build_budget_response(db, budget, base_budget)

    # Reject explicit null because overall_limit is non-nullable on the model
    if "overall_limit" in changed_fields and changed_fields["overall_limit"] is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cannot set to null: overall_limit",
        )

    for field, value in changed_fields.items():
        setattr(budget, field, value)

    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget, base_budget)


@router.get("", response_model=list[BudgetResponse])
async def get_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return budget instances visible to the user

    Args:
        user: Authenticated user requesting budget instances
        db: Active database session

    Returns:
        Budget instances visible through ownership, group admin membership, or explicit permission
    """
    return await get_visible_budget_responses(db, user.id)
