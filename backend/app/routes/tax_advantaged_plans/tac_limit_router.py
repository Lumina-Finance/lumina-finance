"""TAC limit routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.tax_advantaged_plans.tac_limit_creation_helpers import create_tac_limit_for_owned_plan
from app.routes.tax_advantaged_plans.tac_limit_deletion_helpers import delete_tac_limit_for_owned_plan
from app.routes.tax_advantaged_plans.tac_limit_listing_helpers import get_tac_limits_for_owned_plan
from app.routes.tax_advantaged_plans.tac_limit_update_helpers import update_tac_limit_for_owned_plan
from app.schemas.tax_advantaged_plan import (
    CreateTaxAdvantagedPlanLimitRequest,
    TaxAdvantagedPlanLimitResponse,
    UpdateTaxAdvantagedPlanLimitRequest,
)

router = APIRouter(prefix="/{plan_id}/limits")


@router.get("", response_model=list[TaxAdvantagedPlanLimitResponse])
async def list_tax_advantaged_plan_limits(
    plan_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return per-year limits for an owned tax-advantaged plan

    Args:
        plan_id: Plan identifier whose limits should be listed
        user: Authenticated user
        db: Active database session

    Returns:
        Yearly limits ordered by year

    Raises:
        HTTPException: Plan does not exist or belongs to another user
    """
    limit_rows = await get_tac_limits_for_owned_plan(db, plan_id, user.id)
    return limit_rows


@router.post("", response_model=TaxAdvantagedPlanLimitResponse, status_code=status.HTTP_201_CREATED)
async def create_tax_advantaged_plan_limit(
    plan_id: uuid.UUID,
    data: CreateTaxAdvantagedPlanLimitRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a per-year limit for an owned tax-advantaged plan

    Args:
        plan_id: Plan identifier that owns the limit row
        data: Yearly limit creation payload
        user: Authenticated user
        db: Active database session

    Returns:
        Created yearly limit row

    Raises:
        HTTPException: Plan is inaccessible or the year already has a limit row
    """
    limit_row = await create_tac_limit_for_owned_plan(db, plan_id, user.id, data)
    return limit_row


@router.patch("/{year}", response_model=TaxAdvantagedPlanLimitResponse)
async def update_tax_advantaged_plan_limit(
    plan_id: uuid.UUID,
    year: int,
    data: UpdateTaxAdvantagedPlanLimitRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a per-year limit for an owned tax-advantaged plan

    Args:
        plan_id: Plan identifier that owns the limit row
        year: Year to update
        data: Partial yearly limit update payload
        user: Authenticated user
        db: Active database session

    Returns:
        Updated yearly limit row

    Raises:
        HTTPException: Plan or limit row is inaccessible, missing, or invalid
    """
    limit_row = await update_tac_limit_for_owned_plan(db, plan_id, year, user.id, data)
    return limit_row


@router.delete("/{year}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_advantaged_plan_limit(
    plan_id: uuid.UUID,
    year: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a per-year limit for an owned tax-advantaged plan

    Args:
        plan_id: Plan identifier that owns the limit row
        year: Year to delete
        user: Authenticated user
        db: Active database session

    Raises:
        HTTPException: Plan or limit row is inaccessible or missing
    """
    await delete_tac_limit_for_owned_plan(db, plan_id, year, user.id)
