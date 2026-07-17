"""Budget route handlers"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.budgets.budget_deletion_helpers import delete_budget_for_user
from app.routes.budgets.budget_detail_helpers import get_budget_response_for_user
from app.routes.budgets.budget_update_helpers import update_budget_for_user
from app.schemas.budget import (
    BudgetResponse,
    LatestBudgetUtilizationResponse,
    UpdateBudgetRequest,
)
from app.services.budgets.listing import get_visible_budget_responses
from app.services.budgets.utilization import (
    get_latest_budget_utilization_responses,
)

router = APIRouter(prefix="/budgets", tags=["budgets"])


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
    return await get_latest_budget_utilization_responses(db, user.id)


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
    budget = await get_budget_response_for_user(db, budget_id, user.id)
    return budget


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
    await delete_budget_for_user(db, budget_id, user.id)


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
    budget = await update_budget_for_user(db, budget_id, user.id, data)
    return budget


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
