"""Tax-advantaged plan routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import TaxAdvantagedPlan
from app.models.base import TaxTreatment
from app.models.currency import Currency
from app.models.user import User
from app.routes.tax_advantaged_plans.tac_limit_helpers import (
    apply_tac_limit_updates,
    build_tac_limit,
    get_tac_limit_or_404,
    get_tac_limits_for_plan,
    validate_tac_limit_year_available,
)
from app.routes.tax_advantaged_plans.tac_plan_helpers import (
    get_owned_tax_advantaged_plan_or_404,
    validate_tax_advantaged_plan_group_scope,
    validate_tax_advantaged_plan_tax_treatment,
)
from app.schemas.tax_advantaged_plan import (
    CreateTaxAdvantagedPlanLimitRequest,
    CreateTaxAdvantagedPlanRequest,
    TaxAdvantagedPlanLimitResponse,
    TaxAdvantagedPlanResponse,
    UpdateTaxAdvantagedPlanLimitRequest,
    UpdateTaxAdvantagedPlanRequest,
)
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.tax_advantaged_plans import attach_tax_advantaged_plan_metrics

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
    owner_id = user.id

    # Fetch the user's plans in creation order before adding derived limit metrics
    result = await db.execute(
        select(TaxAdvantagedPlan)
        .where(TaxAdvantagedPlan.plan_owner_user_id == owner_id)
        .order_by(TaxAdvantagedPlan.created_at),
    )
    plans = result.scalars().all()
    await attach_tax_advantaged_plan_metrics(db, plans)
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
    validate_tax_advantaged_plan_tax_treatment(data.tax_treatment)
    await validate_tax_advantaged_plan_group_scope(db, data.group_id, user.id)

    # Fetch the currency so plans cannot reference an unsupported currency code
    currency = await db.get(Currency, data.currency)
    if not currency:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    plan = TaxAdvantagedPlan(
        plan_owner_user_id=user.id,
        group_id=data.group_id,
        name=data.name,
        tax_treatment=TaxTreatment(data.tax_treatment),
        currency=data.currency,
        lifetime_contribution_limit=data.lifetime_contribution_limit,
        accrued_contributions=data.accrued_contributions,
    )
    db.add(plan)
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
    await db.refresh(plan)
    await attach_tax_advantaged_plan_metrics(db, [plan])
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
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, user.id)
    await attach_tax_advantaged_plan_metrics(db, [plan])
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
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, user.id)
    previous_group_id = plan.group_id
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        await attach_tax_advantaged_plan_metrics(db, [plan])
        return plan

    if "tax_treatment" in updates:
        if updates["tax_treatment"] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="tax_treatment cannot be null")
        validate_tax_advantaged_plan_tax_treatment(updates["tax_treatment"])

    if "group_id" in updates:
        await validate_tax_advantaged_plan_group_scope(db, updates["group_id"], user.id)

    if "name" in updates and updates["name"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="name cannot be null")

    for field, value in updates.items():
        if field == "tax_treatment":
            value = TaxTreatment(value)
        setattr(plan, field, value)

    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=previous_group_id)
    if plan.group_id != previous_group_id:
        await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
    await db.refresh(plan)
    await attach_tax_advantaged_plan_metrics(db, [plan])
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
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, user.id)
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.delete(plan)
    await db.commit()


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
    await get_owned_tax_advantaged_plan_or_404(db, plan_id, user.id)
    limit_rows = await get_tac_limits_for_plan(db, plan_id)
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
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, user.id)
    await validate_tac_limit_year_available(db, plan_id, data.year)
    row = build_tac_limit(plan_id, data)
    db.add(row)
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
    await db.refresh(row)
    return row


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
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, user.id)
    row = await get_tac_limit_or_404(db, plan_id, year)
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return row

    apply_tac_limit_updates(row, updates)
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
    await db.refresh(row)
    return row


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
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, user.id)
    row = await get_tac_limit_or_404(db, plan_id, year)
    await db.delete(row)
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.commit()
