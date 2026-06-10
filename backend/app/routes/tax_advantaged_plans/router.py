"""Tax-advantaged plan routes"""
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
from app.routes.tax_advantaged_plans.tac_plan_creation_helpers import create_tax_advantaged_plan_with_metrics
from app.routes.tax_advantaged_plans.tac_plan_deletion_helpers import delete_tax_advantaged_plan_for_owner
from app.routes.tax_advantaged_plans.tac_plan_detail_helpers import get_tax_advantaged_plan_with_metrics_for_owner
from app.routes.tax_advantaged_plans.tac_plan_listing_helpers import get_tax_advantaged_plans_with_metrics_for_owner
from app.routes.tax_advantaged_plans.tac_plan_update_helpers import update_tax_advantaged_plan_with_metrics
from app.schemas.tax_advantaged_plan import (
    CreateTaxAdvantagedPlanLimitRequest,
    CreateTaxAdvantagedPlanRequest,
    TaxAdvantagedPlanLimitResponse,
    TaxAdvantagedPlanResponse,
    UpdateTaxAdvantagedPlanLimitRequest,
    UpdateTaxAdvantagedPlanRequest,
)

router = APIRouter(prefix="/tax-advantaged-plans", tags=["tax-advantaged-plans"])


@router.get("", response_model=list[TaxAdvantagedPlanResponse])
async def list_tax_advantaged_plans(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return tax-advantaged plans owned by the authenticated user

    Args:
        user: Authenticated user
        db: Active database session

    Returns:
        Plans owned by the authenticated user with current-year limits attached
    """
    plans = await get_tax_advantaged_plans_with_metrics_for_owner(db, user.id)
    return plans


@router.post("", response_model=TaxAdvantagedPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_tax_advantaged_plan(
    data: CreateTaxAdvantagedPlanRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a tax-advantaged plan owned by the authenticated user

    Args:
        data: Plan creation payload
        user: Authenticated user
        db: Active database session

    Returns:
        Created plan with current-year limits attached

    Raises:
        HTTPException: Tax treatment, group scope, or currency is invalid
    """
    plan = await create_tax_advantaged_plan_with_metrics(db, user.id, data)
    return plan


@router.get("/{plan_id}", response_model=TaxAdvantagedPlanResponse)
async def get_tax_advantaged_plan(
    plan_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return an owned tax-advantaged plan

    Args:
        plan_id: Plan identifier to fetch
        user: Authenticated user
        db: Active database session

    Returns:
        Owned plan with current-year limits attached

    Raises:
        HTTPException: Plan does not exist or belongs to another user
    """
    plan = await get_tax_advantaged_plan_with_metrics_for_owner(db, plan_id, user.id)
    return plan


@router.patch("/{plan_id}", response_model=TaxAdvantagedPlanResponse)
async def update_tax_advantaged_plan(
    plan_id: uuid.UUID,
    data: UpdateTaxAdvantagedPlanRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update an owned tax-advantaged plan

    Args:
        plan_id: Plan identifier to update
        data: Partial plan update payload
        user: Authenticated user
        db: Active database session

    Returns:
        Updated plan with current-year limits attached

    Raises:
        HTTPException: Plan is inaccessible or a supplied field is invalid
    """
    plan = await update_tax_advantaged_plan_with_metrics(db, plan_id, user.id, data)
    return plan


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_advantaged_plan(
    plan_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete an owned tax-advantaged plan

    Args:
        plan_id: Plan identifier to delete
        user: Authenticated user
        db: Active database session

    Raises:
        HTTPException: Plan does not exist or belongs to another user
    """
    await delete_tax_advantaged_plan_for_owner(db, plan_id, user.id)


@router.get("/{plan_id}/limits", response_model=list[TaxAdvantagedPlanLimitResponse])
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


@router.post("/{plan_id}/limits", response_model=TaxAdvantagedPlanLimitResponse, status_code=status.HTTP_201_CREATED)
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


@router.patch("/{plan_id}/limits/{year}", response_model=TaxAdvantagedPlanLimitResponse)
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


@router.delete("/{plan_id}/limits/{year}", status_code=status.HTTP_204_NO_CONTENT)
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
